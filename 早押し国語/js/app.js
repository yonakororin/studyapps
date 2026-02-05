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

            // 認証の初期化
            this.auth = getAuth(this.app);

            // Wait briefly for auth state to resolve
            await new Promise(resolve => {
                const unsubscribe = this.auth.onAuthStateChanged(user => {
                    unsubscribe();
                    resolve(user);
                });
            });

            if (this.auth.currentUser) {
                console.log("Logged in as:", this.auth.currentUser.uid);
            } else {
                console.log("No user signed in. Redirecting to login...");
                // Allow a small grace period or check if we are in a protected view
                // For now, redirect to portal if not logged in
                // Note: Local development might need handling if running pure file
                if (window.location.hostname !== "localhost" && !window.location.href.includes("127.0.0.1")) {
                    window.location.href = "../";
                } else {
                    console.warn("Local env: Skipping redirect. Auth expected.");
                }
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
            details: details,
            timestamp: new Date()
        };

        if (this.useCloud && this.db && this.auth && this.auth.currentUser) {
            try {
                const uid = this.auth.currentUser.uid;
                // Save to users/{uid}/history
                const savePromise = this.addDoc(this.collection(this.db, "users", uid, "history"), record);

                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Cloud save timed out")), 5000)
                );

                await Promise.race([savePromise, timeoutPromise]);

                if (record.details) {
                    await this.updateWordStats(record.details);
                }

                return { success: true, method: 'cloud' };
            } catch (e) {
                console.error("Cloud save failed", e);
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
        if (this.useCloud && this.db && this.auth && this.auth.currentUser) {
            try {
                const uid = this.auth.currentUser.uid;
                const q = this.query(
                    this.collection(this.db, "users", uid, "history"),
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
        if (!this.useCloud || !this.db || !this.auth || !this.auth.currentUser) return;
        const uid = this.auth.currentUser.uid;

        const { doc, setDoc, increment } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

        for (const d of details) {
            // users/{uid}/word_stats/{questionId}
            const ref = doc(this.db, "users", uid, "word_stats", String(d.questionId));

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
        if (this.useCloud && this.db && this.auth && this.auth.currentUser) {
            try {
                const uid = this.auth.currentUser.uid;
                const snapshot = await this.getDocs(this.collection(this.db, "users", uid, "word_stats"));
                return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (e) {
                console.warn("Stats fetch failed", e);
            }
        }
        return [];
    }

    async getUserStats() {
        if (this.useCloud && this.db && this.auth && this.auth.currentUser) {
            try {
                const uid = this.auth.currentUser.uid;
                const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
                // users/{uid} ドキュメント自体に持たせる
                const docRef = doc(this.db, "users", uid);
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    return docSnap.data();
                }
            } catch (e) {
                console.warn("UserStats fetch failed", e);
            }
        }
        return JSON.parse(localStorage.getItem('user_stats') || '{"totalScore": 0}');
    }

    async updateUserStats(scoreToAdd) {
        let stats = { totalScore: 0 };

        if (this.useCloud && this.db && this.auth && this.auth.currentUser) {
            try {
                const { doc, getDoc, setDoc, increment } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
                const uid = this.auth.currentUser.uid;
                const docRef = doc(this.db, "users", uid);

                await setDoc(docRef, {
                    totalScore: increment(scoreToAdd),
                    lastPlayed: new Date()
                }, { merge: true });

                const updatedSnap = await getDoc(docRef);
                return updatedSnap.data();
            } catch (e) {
                console.error("Cloud stats update failed", e);
            }
        }

        // Local fallback
        stats = JSON.parse(localStorage.getItem('user_stats') || '{"totalScore": 0}');
        stats.totalScore += scoreToAdd;
        stats.lastPlayed = new Date().toISOString();
        localStorage.setItem('user_stats', JSON.stringify(stats));
        return stats;
    }

    async fetchQuestions() {
        if (this.useCloud && this.db) {
            try {
                const snapshot = await this.getDocs(this.collection(this.db, "questions"));
                if (!snapshot.empty) {
                    const questions = snapshot.docs.map(doc => doc.data());
                    return questions;
                }
            } catch (e) {
                console.warn("Questions fetch failed (using local):", e);
            }
        }
        return null;
    }
}

// --- REWARD SYSTEM ---
const REWARDS = [
    { score: 5000, id: 'cube', name: 'ブロンズ・キューブ', icon: '🟫', shapeClass: 'shape-cube' },
    { score: 15000, id: 'hex', name: 'シルバー・ヘキサ', icon: '⚪', shapeClass: 'shape-hex' },
    { score: 30000, id: 'star', name: 'ゴールド・スター', icon: '⭐', shapeClass: 'shape-star' },
    { score: 50000, id: 'heart', name: 'フローティング・ハート', icon: '💖', shapeClass: 'shape-heart' }
];

class DecorationManager {
    constructor() {
        this.container = document.querySelector('.background-shapes');
    }

    applyDecorations(totalScore) {
        // Clear existing dynamic shapes (keep default 3 shapes if possible, or clear all and re-add)
        // Default shapes are hardcoded in HTML. Let's append new ones or ensure we don't duplicate.
        // Simple strategy: Remove all elements with 'dynamic-shape' class
        const currentDynamic = document.querySelectorAll('.dynamic-shape');
        currentDynamic.forEach(el => el.remove());

        REWARDS.forEach(reward => {
            if (totalScore >= reward.score) {
                this.addShape(reward.shapeClass);
            }
        });
    }

    addShape(className) {
        const shape = document.createElement('div');
        shape.className = `shape ${className} dynamic-shape`;
        this.container.appendChild(shape);
    }

    checkUnlock(prevScore, newScore) {
        const newUnlocks = REWARDS.filter(r => newScore >= r.score && prevScore < r.score);
        if (newUnlocks.length > 0) {
            // Show latest unlock
            this.showUnlockModal(newUnlocks[newUnlocks.length - 1]);
        }
    }

    showUnlockModal(reward) {
        const modal = document.createElement('div');
        modal.className = 'unlock-modal';
        modal.innerHTML = `
            <div class="unlock-content">
                <div class="unlock-icon">${reward.icon}</div>
                <h2>New Item Unlocked!</h2>
                <p style="font-size: 1.2rem; margin: 10px 0; font-weight:bold;">${reward.name}</p>
                <p>総合スコアが ${reward.score} 点を超えました！</p>
                <p>背景が豪華になりました。</p>
                <button class="btn btn-primary" style="margin-top: 20px;" onclick="this.closest('.unlock-modal').remove()">OK</button>
            </div>
        `;
        document.body.appendChild(modal);
    }
}

// --- GAME LOGIC ---
const QUESTIONS_PER_GAME = 10;
const TIME_PER_QUESTION = 10; // seconds

class Game {
    constructor(ui, storage, decorationManager) {
        this.ui = ui;
        this.storage = storage;
        this.decorationManager = decorationManager;
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

    handleAnswer(selectedChoice, isCorrect, btnElement) {
        clearInterval(this.timerInterval);

        const timeBonus = Math.max(0, Math.floor(this.timeLeft * 10));
        const points = isCorrect ? (100 + timeBonus) : 0;

        if (isCorrect) {
            this.score += points;
            this.ui.updateScore(this.score);
            this.ui.showFeedback(true, btnElement);
        } else {
            this.ui.showFeedback(false, btnElement);
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

        // Update User Stats (Total Score)
        const currentStats = await this.storage.getUserStats();
        const prevTotal = currentStats.totalScore || 0;
        const newStats = await this.storage.updateUserStats(this.score);

        // Decorate background based on new total
        this.decorationManager.applyDecorations(newStats.totalScore);

        // Check for unlocks
        this.decorationManager.checkUnlock(prevTotal, newStats.totalScore);

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
        // Revert reverse logic for V1 safety
        this.elements.qType.textContent = `Q${number}. ${q.type === 'yojijukugo' ? '四字熟語' : q.type === 'kotowaza' ? 'ことわざ' : '故事成語'}`;

        this.elements.qText.textContent = q.term;
        this.elements.qSub.textContent = q.reading || "";

        let options = [...q.choices];
        const correctVal = options[0]; // First is correct in schema

        // Shuffle options
        options.sort(() => Math.random() - 0.5);

        this.elements.optionsGrid.innerHTML = '';
        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.textContent = opt;
            // Add data attribute for correct answer identification
            if (opt === correctVal) btn.dataset.correct = "true";

            btn.onclick = (e) => window.game.handleAnswer(opt, opt === correctVal, e.target);
            this.elements.optionsGrid.appendChild(btn);
        });
    }

    showFeedback(isCorrect, selectedBtn) {
        // Highlight Selected
        if (selectedBtn) {
            selectedBtn.classList.add(isCorrect ? 'correct' : 'wrong');
        }

        // If wrong, highlight correct one too
        if (!isCorrect) {
            const btns = this.elements.optionsGrid.querySelectorAll('.option-btn');
            btns.forEach(btn => {
                if (btn.dataset.correct === "true") {
                    btn.classList.add('correct');
                }
            });
        }

        // No fullscreen flash needed. 
        // We rely on CSS styles for .correct and .wrong defined in style.css
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
const decorationManager = new DecorationManager();
const ui = new UI();
const game = new Game(ui, storage, decorationManager);

// Initial Load of Decorations and UI Info
storage.init().then(async () => {
    // Wait for auth
    setTimeout(async () => {
        // User Info Update
        if (storage.auth && storage.auth.currentUser) {
            const email = storage.auth.currentUser.email || "";
            const displayId = email.split('@')[0] || "Guest";
            document.getElementById('header-user-id').textContent = displayId;
            document.getElementById('user-info-bar').style.display = 'flex';
        }

        const stats = await storage.getUserStats();
        decorationManager.applyDecorations(stats.totalScore || 0);

        // Calculate and Show current Rank Name in Header
        let currentRankName = "";
        for (let i = REWARDS.length - 1; i >= 0; i--) {
            if ((stats.totalScore || 0) >= REWARDS[i].score) {
                currentRankName = REWARDS[i].icon + " " + REWARDS[i].name;
                break;
            }
        }
        if (!currentRankName) currentRankName = "🐣 見習い";
        document.getElementById('header-user-rank').textContent = currentRankName;

    }, 1000);
});

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
    const container = document.getElementById('screen-history');
    // Ensure status container exists
    let statusContainer = document.getElementById('history-status');
    let list = document.getElementById('history-list');

    if (!statusContainer) {
        statusContainer = document.createElement('div');
        statusContainer.id = 'history-status';
        statusContainer.className = 'status-card';
        // Insert before the list
        container.insertBefore(statusContainer, list);
    }

    statusContainer.innerHTML = '<div style="text-align:center;">データ読み込み中...</div>';
    list.innerHTML = '';

    const [records, stats] = await Promise.all([
        storage.getHistory(),
        storage.getUserStats()
    ]);

    // --- Status & Rank Calculation ---
    const totalScore = stats.totalScore || 0;

    let currentRank = { name: '見習い', icon: '🐣', score: 0 };
    let nextReward = REWARDS[0];

    for (let i = 0; i < REWARDS.length; i++) {
        if (totalScore >= REWARDS[i].score) {
            currentRank = REWARDS[i];
            nextReward = REWARDS[i + 1] || null;
        } else {
            nextReward = REWARDS[i];
            break;
        }
    }

    let progressHTML = '';
    if (nextReward) {
        // Progress base is current rank's threshold (or 0)
        // Progress target is next rank
        const base = currentRank.score;
        const target = nextReward.score;
        const progress = Math.min(100, Math.max(0, ((totalScore - base) / (target - base)) * 100));

        progressHTML = `
            <div class="next-goal">
                <span class="goal-label">次のランク: ${nextReward.name}まで</span>
                <span class="goal-value">${(target - totalScore).toLocaleString()} 点</span>
            </div>
            <div class="progress-track">
                <div class="progress-fill" style="width: ${progress}%"></div>
            </div>
            <div class="progress-text">あと ${target - totalScore} 点で ${nextReward.icon} ゲット！</div>
        `;
    } else {
        progressHTML = `<div class="next-goal" style="text-align:center; color:var(--accent);">🏆 最高ランク到達！ 🏆</div>`;
    }

    statusContainer.innerHTML = `
        <div class="rank-header">
            <div class="rank-icon">${currentRank.icon}</div>
            <div class="rank-details">
                <div class="rank-label">現在のランク</div>
                <div class="rank-name">${currentRank.name}</div>
                <div class="total-score">総合スコア: ${totalScore.toLocaleString()}</div>
            </div>
        </div>
        ${progressHTML}
    `;

    // --- History List ---
    if (records.length === 0) {
        list.innerHTML = '<div class="empty-state">まだ記録がありません</div>';
        return;
    }

    records.forEach(r => {
        const item = document.createElement('div');
        item.className = 'history-item';
        const dateStr = new Date(r.date).toLocaleDateString() + ' ' + new Date(r.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
