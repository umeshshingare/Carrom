const socket = io();

// UI Elements
const statusEl = document.getElementById('connection-status');
const roleEl = document.getElementById('role-display');
const turnEl = document.getElementById('turn-indicator');
const scoreP1El = document.getElementById('score-p1');
const scoreP2El = document.getElementById('score-p2');

// Canvas Setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const BOARD_SIZE = 800; // Match server
const POCKET_RADIUS = 35;
const COIN_RADIUS = 15;
const STRIKER_RADIUS = 20;

// Game State
let myRole = 'Spectator'; // 'P1', 'P2', 'Spectator'
let currentTurn = 'P1';
let gameState = null;
let scores = { P1: 0, P2: 0 };

// Interaction State
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let currentMouse = { x: 0, y: 0 };
let isAiming = false; // true when pulling back to strike

// --- Socket Events ---
socket.on('connect', () => {
    statusEl.textContent = 'Connected';
    statusEl.className = 'status connected';
});

socket.on('disconnect', () => {
    statusEl.textContent = 'Disconnected';
    statusEl.className = 'status disconnected';
});

socket.on('init', (data) => {
    myRole = data.role;
    roleEl.textContent = `Role: ${myRole === 'P1' ? 'Player 1 (White)' : myRole === 'P2' ? 'Player 2 (Black)' : 'Spectator'}`;
    currentTurn = data.turn;
    scores = data.scores;
    updateUI();
});

socket.on('scoreUpdate', (newScores) => {
    scores = newScores;
    scoreP1El.textContent = scores.P1;
    scoreP2El.textContent = scores.P2;
});

socket.on('turnChange', (turn) => {
    currentTurn = turn;
    updateUI();
});

socket.on('gameState', (state) => {
    gameState = state;
    draw();
});

function updateUI() {
    if (myRole === 'Spectator') {
        turnEl.textContent = `Current Turn: ${currentTurn === 'P1' ? 'Player 1' : 'Player 2'}`;
        turnEl.className = 'turn-indicator';
        return;
    }

    if (myRole === currentTurn) {
        turnEl.textContent = "Your Turn!";
        turnEl.className = 'turn-indicator active';
    } else {
        turnEl.textContent = "Opponent's Turn...";
        turnEl.className = 'turn-indicator';
    }
}

// --- Interaction Logic ---
canvas.addEventListener('mousedown', (e) => {
    if (myRole !== currentTurn || gameState?.isBoardMoving) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if clicking near striker
    if (gameState && gameState.striker) {
        const dx = x - gameState.striker.x;
        const dy = y - gameState.striker.y;
        if (Math.sqrt(dx*dx + dy*dy) < STRIKER_RADIUS + 10) {
            isDragging = true;
            dragStart = { x, y };
            isAiming = true;
        } else {
            // Placing striker (only horizontal)
            let limitY = currentTurn === 'P1' ? BOARD_SIZE - 120 : 120;
            if (Math.abs(y - limitY) < 50) {
                socket.emit('place_striker', { x: x });
                // Allow dragging striker horizontally
                isDragging = true;
                isAiming = false;
            }
        }
    }
});

window.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    currentMouse.x = e.clientX - rect.left;
    currentMouse.y = e.clientY - rect.top;

    if (isDragging) {
        if (!isAiming) {
            // Placing striker dynamically
            socket.emit('place_striker', { x: currentMouse.x });
        }
    }
});

window.addEventListener('mouseup', () => {
    if (isDragging && isAiming && myRole === currentTurn && !gameState?.isBoardMoving) {
        // Calculate strike vector (pull back to shoot forward)
        let dx = dragStart.x - currentMouse.x;
        let dy = dragStart.y - currentMouse.y;
        
        // Cap the maximum pull distance to limit max power
        const pullDistance = Math.sqrt(dx*dx + dy*dy);
        const MAX_PULL = 200;
        if (pullDistance > MAX_PULL) {
            const scale = MAX_PULL / pullDistance;
            dx *= scale;
            dy *= scale;
        }
        
        // Min threshold to avoid accidental tiny taps
        if (pullDistance > 10) {
            // Multiplier for force feeling right
            socket.emit('strike', { vx: dx * 0.6, vy: dy * 0.6 });
        }
    }
    isDragging = false;
    isAiming = false;
});

// --- Drawing Logic ---
function draw() {
    if (!gameState) return;

    // Clear board (done by background color, but we can add patterns)
    ctx.clearRect(0, 0, BOARD_SIZE, BOARD_SIZE);

    // Draw Board Lines
    drawBoardMarkings();

    // Draw Pockets
    ctx.fillStyle = '#111';
    const pockets = [
        [0, 0], [BOARD_SIZE, 0], [0, BOARD_SIZE], [BOARD_SIZE, BOARD_SIZE]
    ];
    pockets.forEach(p => {
        ctx.beginPath();
        ctx.arc(p[0], p[1], POCKET_RADIUS, 0, Math.PI * 2);
        ctx.fill();
    });

    // Draw Coins
    gameState.coins.forEach(c => {
        ctx.beginPath();
        ctx.arc(c.x, c.y, COIN_RADIUS, 0, Math.PI * 2);
        if (c.type === 'white') {
            ctx.fillStyle = '#f8fafc';
            ctx.strokeStyle = '#cbd5e1';
        } else if (c.type === 'black') {
            ctx.fillStyle = '#1e293b';
            ctx.strokeStyle = '#0f172a';
        } else if (c.type === 'queen') {
            ctx.fillStyle = '#ef4444';
            ctx.strokeStyle = '#b91c1c';
        }
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.stroke();

        // Inner detail
        ctx.beginPath();
        ctx.arc(c.x, c.y, COIN_RADIUS * 0.6, 0, Math.PI * 2);
        ctx.stroke();
    });

    // Draw Striker
    if (gameState.striker) {
        ctx.beginPath();
        ctx.arc(gameState.striker.x, gameState.striker.y, STRIKER_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = '#fef08a'; // Yellowish white
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ca8a04';
        ctx.stroke();
        
        // Inner detail
        ctx.beginPath();
        ctx.arc(gameState.striker.x, gameState.striker.y, STRIKER_RADIUS * 0.5, 0, Math.PI * 2);
        ctx.stroke();

        // Draw Aiming Line
        if (isDragging && isAiming) {
            ctx.beginPath();
            ctx.moveTo(gameState.striker.x, gameState.striker.y);
            // Opposite direction of drag
            let dx = dragStart.x - currentMouse.x;
            let dy = dragStart.y - currentMouse.y;
            
            // Cap visual line to match physics cap
            const pullDistance = Math.sqrt(dx*dx + dy*dy);
            const MAX_PULL = 200;
            if (pullDistance > MAX_PULL) {
                const scale = MAX_PULL / pullDistance;
                dx *= scale;
                dy *= scale;
            }

            ctx.lineTo(gameState.striker.x + dx, gameState.striker.y + dy);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 4;
            ctx.setLineDash([10, 10]);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
}

function drawBoardMarkings() {
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;

    // Center Circle
    ctx.beginPath();
    ctx.arc(BOARD_SIZE/2, BOARD_SIZE/2, COIN_RADIUS * 4.5, 0, Math.PI*2);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.arc(BOARD_SIZE/2, BOARD_SIZE/2, COIN_RADIUS * 0.5, 0, Math.PI*2);
    ctx.fillStyle = '#ef4444';
    ctx.fill();

    // Baseline areas (P1 bottom, P2 top)
    const drawBaseLine = (y) => {
        ctx.beginPath();
        ctx.moveTo(150, y - 10);
        ctx.lineTo(BOARD_SIZE - 150, y - 10);
        ctx.moveTo(150, y + 10);
        ctx.lineTo(BOARD_SIZE - 150, y + 10);
        ctx.stroke();

        // End circles
        ctx.beginPath(); ctx.arc(150, y, 15, 0, Math.PI*2); ctx.stroke();
        ctx.beginPath(); ctx.arc(BOARD_SIZE - 150, y, 15, 0, Math.PI*2); ctx.stroke();
    };

    drawBaseLine(120); // Top (P2)
    drawBaseLine(BOARD_SIZE - 120); // Bottom (P1)
    
    // Side baselines (Optional visual flair)
    ctx.save();
    ctx.translate(BOARD_SIZE/2, BOARD_SIZE/2);
    ctx.rotate(Math.PI/2);
    ctx.translate(-BOARD_SIZE/2, -BOARD_SIZE/2);
    drawBaseLine(120);
    drawBaseLine(BOARD_SIZE - 120);
    ctx.restore();

    // Corner lines
    const drawCornerLine = (x1, y1, x2, y2) => {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        // Decorator
        ctx.beginPath();
        ctx.arc(x1 + (x2-x1)*0.8, y1 + (y2-y1)*0.8, 10, 0, Math.PI*2);
        ctx.stroke();
    };
    
    drawCornerLine(150, 150, 60, 60);
    drawCornerLine(BOARD_SIZE - 150, 150, BOARD_SIZE - 60, 60);
    drawCornerLine(150, BOARD_SIZE - 150, 60, BOARD_SIZE - 60);
    drawCornerLine(BOARD_SIZE - 150, BOARD_SIZE - 150, BOARD_SIZE - 60, BOARD_SIZE - 60);
}
