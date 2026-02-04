# 早押し国語 (Fast Push Kokugo) - Implementation Plan

## Overview
A web-based learning application for Junior High School entrance exams, focusing on Japanese language skills (Four-character idioms, Proverbs, Classical idioms). The app features a speed-based quiz format and tracks learning progress via cloud storage.

## Target Platform
- **Smartphone & Web** (Responsive Web App)
- **Cloud**: Firebase (Firestore) for data storage [Free Tier]

## Features

### 1. Game Mechanics (Speed Quiz)
- **Modes**:
  - Word to Meaning (Display Idiom -> Choose Meaning)
  - Meaning to Word (Display Meaning -> Choose Idiom)
- **Scoring**:
  - Base points for correct answer.
  - Time bonus (faster answer = more points).
  - Combo system (consecutive correct answers).
- **Content**:
  - Data structure supporting: `Term`, `Meaning`, `Type` (Yojijukugo, Kotowaza, etc.), `Difficulty`.

### 2. User Experience (UX/UI)
- **Aesthetic**: Premium, energetic, modern. High contrast for readability.
- **Animations**: Smooth transitions, feedback animations (Correct/Incorrect), timer countdowns.
- **Responsiveness**: Mobile-first design.

### 3. Learning History
- **Cloud Sync**: Save session results (Score, Date, Category) to Firebase.
- **Review**: View past performance in a simple list/graph format.

## Technical Architecture

### Stack
- **HTML5**: Semantic structure.
- **CSS3**: Vanilla CSS with Variables, Flexbox/Grid. No frameworks (per requirements).
- **JavaScript**: ES6+ Modules. No build step (due to environment constraints).
- **Firebase**: Imported via CDN (ES Modules).

### Directory Structure
```
/c:/Projects/学習アプリ/早押し国語/
  ├── index.html          # Main entry
  ├── css/
  │   └── style.css       # All styles
  ├── js/
  │   ├── app.js          # App controller / Routing
  │   ├── game.js         # Game logic (Timer, Score)
  │   ├── data.js         # Question database
  │   └── storage.js      # Firebase integration
  └── assets/             # Images/Icons (if any)
```

## Step-by-Step Implementation
1.  **Project Setup**: Create file structure.
2.  **UI Construction**: Build `index.html` with distinct "Screens" (Home, Game, Result, History).
3.  **Styling**: Implement `style.css` with a premium color palette (Deep Blue, Vibrant Orange, Soft Whites).
4.  **Logic - Data**: Populate `data.js` with sample content.
5.  **Logic - Game**: Implement the quiz flow in `game.js`.
6.  **Logic - Cloud**: Setup `storage.js` with Firebase boilerplate.
7.  **Integration**: Wire everything in `app.js`.
