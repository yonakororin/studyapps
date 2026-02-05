import { questionData } from './data.js';

import { firebaseConfig } from './config.js';

// --- STORAGE SERVICE ---
class StorageService {
    constructor() {
        this.useCloud = false;
        this.db = null;
        this.collectionName = "study_records";
        this.init();
    }

    async init() {
        // Check if Firebase keys are present
        if (firebaseConfig.apiKey === "YOUR_API_KEY") {
            console.warn("Firebase not configured. Using LocalStorage.");
            return;
        }

        try {
            // Dynamic import to avoid errors if CDN fails or offline
            const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js");
            const { getFirestore, collection, addDoc, getDocs, orderBy, query, limit } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
            const { getAuth, signInAnonymously } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");

            this.app = initializeApp(firebaseConfig);
            this.db = getFirestore(this.app);
            this.collection = collection;
            this.addDoc = addDoc;
            this.getDocs = getDocs;
            this.orderBy = orderBy;
            this.query = query;
            this.limit = limit;

            // 認証の初期化と匿名ログイン
            this.auth = getAuth(this.app);
            try {
                await signInAnonymously(this.auth);
                console.log("Firebase signed in anonymously");
            } catch (authErr) {
                console.warn("Anonymous auth failed (check Firebase Console):", authErr);
            }

            this.useCloud = true;
            console.log("Firebase initialized");
        } catch (e) {
            console.error("Firebase init failed:", e);
        }
    }

    async saveRecord(score, totalQuestions, correctCount, details = null) {
        const record = {
            date: new Date().toISOString(),
            score: score,
            correct: correctCount,
            total: totalQuestions,
            details: details // Array of { questionId, isCorrect, ... }
        };

        if (this.useCloud && this.db) {
            try {
                // 認証チェックと再試行
                if (this.auth && !this.auth.currentUser) {
                    console.log("Not signed in, attempting anonymous sign in...");
                    await signInAnonymously(this.auth);
                }

                // 5秒でタイムアウトするように設定
                const savePromise = this.addDoc(this.collection(this.db, this.collectionName), {
                    ...record,
                    timestamp: new Date()
                });
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Cloud save timed out")), 5000)
                );

                await Promise.race([savePromise, timeoutPromise]);
                // 結果詳細（各問題の正誤）の保存（別コレクションまたはサブコレクション）
                // 簡略化のため、問題ごとの集計用コレクション 'word_stats' を更新
                if (record.details) {
                    await this.updateWordStats(record.details);
                }

                return { success: true, method: 'cloud' };
            } catch (e) {
                console.error("Cloud save failed", e);
                // 失敗時はローカル保存へフォールバック。エラー情報を保持
                var cloudError = e;
            }
        }

        // Fallback to LocalStorage
        const localHistory = JSON.parse(localStorage.getItem('study_history') || '[]');
        localHistory.unshift(record);
        localStorage.setItem('study_history', JSON.stringify(localHistory.slice(0, 50)));
        return { success: false, method: 'local', error: cloudError };
    }

    async getHistory() {
        if (this.useCloud && this.db) {
            try {
                const q = this.query(
                    this.collection(this.db, this.collectionName),
                    this.orderBy("timestamp", "desc"),
                    this.limit(20)
                );
                const snapshot = await this.getDocs(q);
                return snapshot.docs.map(doc => {
                    const data = doc.data();
                    return {
                        ...data,
                        date: data.timestamp ? new Date(data.timestamp.seconds * 1000).toISOString() : data.date
                    };
                });
            } catch (e) {
                console.error("Cloud fetch failed", e);
            }
        }
        return JSON.parse(localStorage.getItem('study_history') || '[]');
    }

    async updateWordStats(details) {
        if (!this.useCloud || !this.db) return;

        // Note: Real scalable apps use Cloud Functions / Aggregations. 
        // Here we do client-side increments (beware of race conditions in high concurrency)
        const { doc, getDoc, setDoc, updateDoc, increment } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

        for (const d of details) {
            const ref = doc(this.db, "word_stats", String(d.questionId));

            // Use setDoc with merge: true to handle both create and update without errors
            await setDoc(ref, {
                total: increment(1),
                correct: increment(d.isCorrect ? 1 : 0),
                wrong: increment(d.isCorrect ? 0 : 1),
                lastPlayed: new Date(),
                term: d.term,
                meaning: d.meaning,
                type: d.type
            }, { merge: true });
        }
    }

    async getWordStats() {
        if (this.useCloud && this.db) {
            try {
                const snapshot = await this.getDocs(this.collection(this.db, "word_stats"));
                return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (e) {
                console.warn("Stats fetch failed", e);
            }
        }
        return [];
    }

    async fetchQuestions() {
        if (this.useCloud && this.db) {
            try {
                const snapshot = await this.getDocs(this.collection(this.db, "questions"));
                if (!snapshot.empty) {
                    const questions = snapshot.docs.map(doc => doc.data());
                    console.log(`Firebaseから${questions.length}件の問題を読み込みました`);
                    return questions;
                }
            } catch (e) {
                console.warn("Questions fetch failed (using local):", e);
            }
        }
        return null; // Fallback to local
    }
}

// --- GAME LOGIC ---
const QUESTIONS_PER_GAME = 10;
const TIME_PER_QUESTION = 10; // seconds

class Game {
    constructor(ui, storage) {
        this.ui = ui;
        this.storage = storage;
        this.score = 0;
        this.currentQuestionIndex = 0;
        this.questions = [];
        this.timerInterval = null;
        this.timeLeft = 0;
        this.isPlaying = false;
    }

    async start(difficulty) {
        this.score = 0;
        this.currentQuestionIndex = 0;
        this.gameLogs = []; // Reset logs
        this.ui.showScreen('loading'); // 簡易的なローディング表示（該当要素が必要だが、一旦UI操作なしで待機）

        // 問題の取得（Cloud -> Local Fallback）
        let loadedQuestions = await this.storage.fetchQuestions();
        let source = 'cloud';

        if (!loadedQuestions || loadedQuestions.length === 0) {
            loadedQuestions = questionData;
            source = 'local';
            console.log("ローカルデータを使用します");
        }

        // 重複排除 (Term基準)
        const uniqueQuestions = [];
        const seenTerms = new Set();
        (loadedQuestions || []).forEach(q => {
            if (!seenTerms.has(q.term)) {
                seenTerms.add(q.term);
                uniqueQuestions.push(q);
            }
        });

        this.ui.showDataSource(source);

        this.questions = this.shuffleQuestions(uniqueQuestions).slice(0, QUESTIONS_PER_GAME);
        this.isPlaying = true;

        this.ui.showScreen('game');
        this.nextQuestion();
    }

    shuffleQuestions(array) {
        return [...array].sort(() => Math.random() - 0.5);
    }

    nextQuestion() {
        if (this.currentQuestionIndex >= this.questions.length) {
            this.finishGame();
            return;
        }

        const q = this.questions[this.currentQuestionIndex];
        this.ui.renderQuestion(q, this.currentQuestionIndex + 1);

        this.timeLeft = TIME_PER_QUESTION;
        this.ui.updateTimer(100);
        this.startTimer();
    }

    startTimer() {
        clearInterval(this.timerInterval);
        const step = 100; // ms

        this.timerInterval = setInterval(() => {
            this.timeLeft -= step / 1000;
            const percentage = (this.timeLeft / TIME_PER_QUESTION) * 100;
            this.ui.updateTimer(percentage);

            if (this.timeLeft <= 0) {
                this.handleAnswer(null, false); // Time up
            }
        }, step);
    }

    handleAnswer(selectedChoice, isCorrect) {
        clearInterval(this.timerInterval);

        const timeBonus = Math.max(0, Math.floor(this.timeLeft * 10));
        const points = isCorrect ? (100 + timeBonus) : 0;

        if (isCorrect) {
            this.score += points;
            this.ui.updateScore(this.score);
            this.ui.showFeedback(true);
            // Optional: Add streak logic here
        } else {
            this.ui.showFeedback(false);
        }

        // Save Game Log
        const q = this.questions[this.currentQuestionIndex];
        this.gameLogs.push({
            questionId: q.id,
            term: q.term,
            meaning: q.meaning,
            type: q.type,
            isCorrect: isCorrect,
            time: TIME_PER_QUESTION - this.timeLeft
        });

        setTimeout(() => {
            this.currentQuestionIndex++;
            this.nextQuestion();
        }, 1000);
    }

    async finishGame() {
        this.isPlaying = false;
        this.ui.showScreen('result');

        // Correct count from logs
        const correctCount = this.gameLogs.filter(l => l.isCorrect).length;
        this.ui.renderResult(this.score, correctCount, QUESTIONS_PER_GAME);

        const result = await this.storage.saveRecord(this.score, QUESTIONS_PER_GAME, correctCount, this.gameLogs);
        if (result.success) {
            this.ui.setSaveStatus("保存完了 (クラウド)");
        } else {
            // エラーの詳細を表示してデバッグしやすくする
            let errorMsg = "端末内";
            if (result.error) {
                // エラーメッセージの短縮
                const msg = result.error.toString();
                if (msg.includes("permission-denied")) errorMsg = "権限エラー";
                else if (msg.includes("timed out")) errorMsg = "タイムアウト";
                else if (msg.includes("operation-not-allowed")) errorMsg = "Auth設定未許可";
                else errorMsg = `エラー: ${msg}`; // Show actual error for debugging
            }
            this.ui.setSaveStatus(`保存完了 (${errorMsg}のため端末保存)`);
        }
    }
}

// --- UI MANAGER ---
class UI {
    constructor(game) {
        this.screens = {
            home: document.getElementById('screen-home'),
            game: document.getElementById('screen-game'),
            result: document.getElementById('screen-result'),
            history: document.getElementById('screen-history'),
            loading: document.getElementById('screen-loading'),
            stats: document.getElementById('screen-stats')
        };

        this.elements = {
            timerBar: document.getElementById('timer-bar'),
            currentScore: document.getElementById('current-score'),
            qType: document.getElementById('question-type'),
            qText: document.getElementById('question-text'),
            qSub: document.getElementById('question-sub'),
            optionsGrid: document.getElementById('options-grid'),
            resultScore: document.getElementById('result-score'),
            historyList: document.getElementById('history-list')
        };
    }

    showScreen(name) {
        Object.values(this.screens).forEach(s => {
            s.classList.add('hidden');
            s.classList.remove('active');
        });
        this.screens[name].classList.remove('hidden');
        // Force reflow for animation
        void this.screens[name].offsetWidth;
        this.screens[name].classList.add('active');
    }

    showDataSource(source) {
        const msg = source === 'cloud' ? 'Firebaseから問題を取得しました' : '端末内の問題データを使用します';
        const color = source === 'cloud' ? '#10B981' : '#6B7280';

        const flash = document.createElement('div');
        Object.assign(flash.style, {
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: color,
            color: 'white',
            padding: '10px 20px',
            borderRadius: '20px',
            fontSize: '14px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            zIndex: '2000',
            opacity: '0',
            transition: 'opacity 0.3s'
        });
        flash.textContent = msg;
        document.body.appendChild(flash);

        // Fade in
        requestAnimationFrame(() => flash.style.opacity = '1');

        // Remove after 3s
        setTimeout(() => {
            flash.style.opacity = '0';
            setTimeout(() => flash.remove(), 300);
        }, 3000);
    }

    updateTimer(percentage) {
        this.elements.timerBar.style.width = `${percentage}%`;
        if (percentage < 30) {
            this.elements.timerBar.style.backgroundColor = '#EF4444';
        } else {
            this.elements.timerBar.style.backgroundColor = '#F59E0B';
        }
    }

    updateScore(score) {
        this.elements.currentScore.textContent = score;
        // Animation effect
        this.elements.currentScore.style.transform = "scale(1.2)";
        setTimeout(() => this.elements.currentScore.style.transform = "scale(1)", 200);
    }

    renderQuestion(q, number) {
        // Mode: Word -> Meaning (Default)
        // Could randomize mode here
        const isReverse = Math.random() > 0.8; // 20% chance of meaning -> word

        this.elements.qType.textContent = `Q${number}. ${q.type === 'yojijukugo' ? '四字熟語' : q.type === 'kotowaza' ? 'ことわざ' : '故事成語'}`;

        if (!isReverse) {
            this.elements.qText.textContent = q.term;
            this.elements.qSub.textContent = q.reading; // Show reading? Or hide it for difficulty?
        } else {
            this.elements.qText.textContent = q.meaning;
            this.elements.qSub.textContent = "この意味の言葉は？";
        }

        this.elements.optionsGrid.innerHTML = '';

        // Prepare options
        const correctAnswer = !isReverse ? q.meaning : q.term;
        let options = q.choices.map(c => c); // Copy

        // If reverse, we need to find terms for the wrong operational choices. 
        // But our data structure stores wrong *meanings* in choices array.
        // For reverse mode, we need wrong *terms*.
        // Simplified: Only support Word -> Meaning for now, or use data properly.
        // Let's stick to Word -> Meaning for V1 to ensure quality data match.

        // Revert reverse logic for V1 safety
        this.elements.qText.textContent = q.term;
        this.elements.qSub.textContent = q.reading || "";
        options = [...q.choices];
        const correctVal = options[0]; // Assuming first is always correct in data.js structure, we need to shuffle options.

        // Shuffle options
        options.sort(() => Math.random() - 0.5);

        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.textContent = opt;
            btn.onclick = () => window.game.handleAnswer(opt, opt === correctVal);
            this.elements.optionsGrid.appendChild(btn);
        });
    }

    showFeedback(isCorrect) {
        const color = isCorrect ? 'var(--success)' : 'var(--error)';
        const flash = document.createElement('div');
        flash.style.position = 'fixed';
        flash.style.top = 0;
        flash.style.left = 0;
        flash.style.width = '100%';
        flash.style.height = '100%';
        flash.style.backgroundColor = color;
        flash.style.opacity = 0.3;
        flash.style.zIndex = 100;
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 200);

        if (isCorrect) {
            // Find correct button and color it green
            const btns = this.elements.optionsGrid.querySelectorAll('.option-btn');
            // Logic to highlight correct pressed button is handled by reconstruction on next render
        }
    }

    renderResult(score, correct, total) {
        this.elements.resultScore.textContent = score;
        // this.elements.resultCorrect.textContent = correct; 
        // Implementation needed to pass stats
    }

    setSaveStatus(msg) {
        const el = document.getElementById('save-status');
        if (el) el.textContent = msg;
    }
}

// --- INITIALIZATION ---
const storage = new StorageService();
const ui = new UI();
const game = new Game(ui, storage);
window.game = game; // Expose for callbacks

// Event Listeners
document.getElementById('start-game-btn').addEventListener('click', async () => {
    const btn = document.getElementById('start-game-btn');
    btn.textContent = "読み込み中...";
    btn.disabled = true;

    // const diff = document.getElementById('difficulty-select').value;
    await game.start('normal');

    btn.textContent = "スタート";
    btn.disabled = false;
});

document.getElementById('restart-btn').addEventListener('click', () => {
    game.start('normal');
});

document.getElementById('home-btn').addEventListener('click', () => {
    ui.showScreen('home');
});

document.getElementById('nav-history').addEventListener('click', async () => {
    ui.showScreen('history');
    const list = document.getElementById('history-list');
    list.innerHTML = '<div class="empty-state">読み込み中...</div>';

    const records = await storage.getHistory();
    list.innerHTML = '';

    if (records.length === 0) {
        list.innerHTML = '<div class="empty-state">まだ記録がありません</div>';
        return;
    }

    records.forEach(r => {
        const item = document.createElement('div');
        item.className = 'history-item';
        const dateStr = new Date(r.date).toLocaleDateString() + ' ' + new Date(r.date).toLocaleTimeString();
        item.innerHTML = `
            <span class="h-date">${dateStr}</span>
            <span class="h-score">${r.score} 点</span>
        `;
        list.appendChild(item);
    });
});

document.getElementById('history-back-btn').addEventListener('click', () => {
    ui.showScreen('home');
});

// Stats Screen
document.getElementById('stats-btn').addEventListener('click', async () => {
    ui.showScreen('stats');
    const list = document.getElementById('stats-list');
    list.innerHTML = '<div class="empty-state">集計中...</div>';

    const stats = await storage.getWordStats();

    const renderStats = (sortKey) => {
        list.innerHTML = '';
        if (stats.length === 0) {
            list.innerHTML = '<div class="empty-state">まだデータがありません</div>';
            return;
        }

        // Sort
        const sorted = [...stats].sort((a, b) => {
            if (sortKey === 'wrong_desc') return b.wrong - a.wrong;
            if (sortKey === 'correct_desc') return b.correct - a.correct;
            return b.lastPlayed - a.lastPlayed; // recent
        });

        sorted.forEach(s => {
            const item = document.createElement('div');
            item.className = 'stat-item';
            const rate = Math.round((s.correct / s.total) * 100);
            item.innerHTML = `
                <div class="stat-info">
                    <h3>${s.term}</h3>
                    <div class="meta" style="margin-bottom: 4px; color: #555;">${s.meaning || ''}</div>
                    <div class="meta">正答率: ${rate}% (${s.correct}/${s.total})</div>
                </div>
                <div class="stat-bars">
                   <div class="bar-row">
                       <span class="bar-label">○</span>
                       <div class="bar-track"><div class="bar-fill correct" style="width: ${(s.correct / s.total) * 100}%"></div></div>
                       <span class="bar-count">${s.correct}</span>
                   </div>
                   <div class="bar-row">
                       <span class="bar-label">×</span>
                       <div class="bar-track"><div class="bar-fill wrong" style="width: ${(s.wrong / s.total) * 100}%"></div></div>
                       <span class="bar-count">${s.wrong}</span>
                   </div>
                </div>
            `;
            list.appendChild(item);
        });
    };

    renderStats('wrong_desc');

    document.getElementById('stats-sort').onchange = (e) => {
        renderStats(e.target.value);
    };
});

document.getElementById('stats-back-btn').addEventListener('click', () => {
    ui.showScreen('home');
});
