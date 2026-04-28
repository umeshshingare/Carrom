const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Matter = require('matter-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// --- Matter.js Setup ---
const Engine = Matter.Engine,
      World = Matter.World,
      Bodies = Matter.Bodies,
      Body = Matter.Body,
      Vector = Matter.Vector,
      Events = Matter.Events;

const engine = Engine.create();
const world = engine.world;

// Disable gravity for top-down game
engine.gravity.y = 0;
engine.gravity.x = 0;

// Game Constants
const BOARD_SIZE = 800;
const POCKET_RADIUS = 35;
const COIN_RADIUS = 15;
const STRIKER_RADIUS = 20;

const FRICTION_AIR = 0.015;
const RESTITUTION = 0.8; // Bounciness

// Game State
let players = {
    P1: null, // Socket ID for White
    P2: null  // Socket ID for Black
};
let currentTurn = 'P1'; // P1 or P2
let isBoardMoving = false;
let striker = null;
let coins = [];
let pockets = [];
let scores = { P1: 0, P2: 0 };

// --- Initialize Board ---
function initBoard() {
    World.clear(world);
    Engine.clear(engine);
    coins = [];
    
    // Boundaries (thickness 20)
    const wallOptions = { isStatic: true, restitution: RESTITUTION, render: { visible: false } };
    World.add(world, [
        Bodies.rectangle(BOARD_SIZE/2, -10, BOARD_SIZE, 20, wallOptions), // Top
        Bodies.rectangle(BOARD_SIZE/2, BOARD_SIZE+10, BOARD_SIZE, 20, wallOptions), // Bottom
        Bodies.rectangle(-10, BOARD_SIZE/2, 20, BOARD_SIZE, wallOptions), // Left
        Bodies.rectangle(BOARD_SIZE+10, BOARD_SIZE/2, 20, BOARD_SIZE, wallOptions) // Right
    ]);

    // Pockets (Sensor bodies to detect potting)
    const pocketOptions = { isStatic: true, isSensor: true, label: 'pocket' };
    pockets = [
        Bodies.circle(0, 0, POCKET_RADIUS, pocketOptions), // Top Left
        Bodies.circle(BOARD_SIZE, 0, POCKET_RADIUS, pocketOptions), // Top Right
        Bodies.circle(0, BOARD_SIZE, POCKET_RADIUS, pocketOptions), // Bottom Left
        Bodies.circle(BOARD_SIZE, BOARD_SIZE, POCKET_RADIUS, pocketOptions) // Bottom Right
    ];
    World.add(world, pockets);

    // Striker
    striker = Bodies.circle(BOARD_SIZE/2, BOARD_SIZE - 100, STRIKER_RADIUS, {
        label: 'striker',
        restitution: RESTITUTION,
        frictionAir: FRICTION_AIR,
        density: 0.005, // Slightly heavier
    });
    World.add(world, striker);

    // Create Coins (9 White, 9 Black, 1 Red)
    // Simple circular arrangement for now
    const center = { x: BOARD_SIZE/2, y: BOARD_SIZE/2 };
    
    const addCoin = (x, y, type) => {
        const coin = Bodies.circle(x, y, COIN_RADIUS, {
            label: type,
            restitution: RESTITUTION,
            frictionAir: FRICTION_AIR,
            density: 0.002
        });
        coins.push(coin);
        World.add(world, coin);
    };

    // Red Queen
    addCoin(center.x, center.y, 'queen');

    // Inner Circle (6 coins: 3 White, 3 Black)
    const innerRadius = COIN_RADIUS * 2.1;
    for(let i=0; i<6; i++) {
        const angle = i * (Math.PI * 2 / 6);
        const type = i % 2 === 0 ? 'white' : 'black';
        addCoin(center.x + Math.cos(angle) * innerRadius, center.y + Math.sin(angle) * innerRadius, type);
    }

    // Outer Circle (12 coins: 6 White, 6 Black)
    const outerRadius = COIN_RADIUS * 4.2;
    for(let i=0; i<12; i++) {
        const angle = i * (Math.PI * 2 / 12);
        const type = i % 2 === 0 ? 'black' : 'white'; // Alternate
        addCoin(center.x + Math.cos(angle) * outerRadius, center.y + Math.sin(angle) * outerRadius, type);
    }
}

initBoard();

// --- Pocketing Logic ---
Events.on(engine, 'collisionStart', (event) => {
    const pairs = event.pairs;
    for (let i = 0; i < pairs.length; i++) {
        const bodyA = pairs[i].bodyA;
        const bodyB = pairs[i].bodyB;

        let pocket = null;
        let body = null;

        if (bodyA.label === 'pocket') { pocket = bodyA; body = bodyB; }
        else if (bodyB.label === 'pocket') { pocket = bodyB; body = bodyA; }

        if (pocket && body) {
            handlePotting(body);
        }
    }
});

function handlePotting(body) {
    if (body.label === 'striker') {
        // Foul - Reset striker immediately and change turn later
        Body.setPosition(striker, { x: BOARD_SIZE/2, y: currentTurn === 'P1' ? BOARD_SIZE - 100 : 100 });
        Body.setVelocity(striker, { x: 0, y: 0 });
    } else {
        // Coin potted
        World.remove(world, body);
        coins = coins.filter(c => c !== body);

        // Update score
        if (body.label === 'white') scores.P1 += 10;
        if (body.label === 'black') scores.P2 += 10;
        if (body.label === 'queen') {
            if (currentTurn === 'P1') scores.P1 += 50;
            else scores.P2 += 50;
        }
        
        io.emit('scoreUpdate', scores);
    }
}

// --- Socket.io Handlers ---
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Assign Roles
    let role = 'Spectator';
    if (!players.P1) {
        players.P1 = socket.id;
        role = 'P1';
    } else if (!players.P2) {
        players.P2 = socket.id;
        role = 'P2';
    }
    
    socket.emit('init', { role: role, turn: currentTurn, scores: scores });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        if (players.P1 === socket.id) players.P1 = null;
        if (players.P2 === socket.id) players.P2 = null;
    });

    socket.on('place_striker', (data) => {
        if (!isBoardMoving && (socket.id === players[currentTurn])) {
            // Validate limits based on turn
            let y = currentTurn === 'P1' ? BOARD_SIZE - 120 : 120;
            let x = Math.max(150, Math.min(data.x, BOARD_SIZE - 150));
            Body.setPosition(striker, { x: x, y: y });
            Body.setVelocity(striker, { x: 0, y: 0 });
        }
    });

    socket.on('strike', (data) => {
        if (!isBoardMoving && (socket.id === players[currentTurn])) {
            // Apply force
            Body.applyForce(striker, striker.position, {
                x: data.vx * 0.005,
                y: data.vy * 0.005
            });
            isBoardMoving = true;
        }
    });
});

// --- Game Loop ---
const FPS = 60;
setInterval(() => {
    Engine.update(engine, 1000 / FPS);

    // Check if board stopped moving
    if (isBoardMoving) {
        let moving = false;
        if (striker.speed > 0.1) moving = true;
        coins.forEach(c => {
            if (c.speed > 0.1) moving = true;
        });

        if (!moving) {
            isBoardMoving = false;
            // Stop everything perfectly
            Body.setVelocity(striker, {x:0, y:0});
            coins.forEach(c => Body.setVelocity(c, {x:0, y:0}));
            
            // Switch Turn
            currentTurn = currentTurn === 'P1' ? 'P2' : 'P1';
            
            // Reset Striker Position
            Body.setPosition(striker, { 
                x: BOARD_SIZE/2, 
                y: currentTurn === 'P1' ? BOARD_SIZE - 120 : 120 
            });

            io.emit('turnChange', currentTurn);
        }
    }

    // Broadcast Game State
    const state = {
        striker: { x: striker.position.x, y: striker.position.y },
        coins: coins.map(c => ({
            id: c.id,
            x: c.position.x,
            y: c.position.y,
            type: c.label
        })),
        isBoardMoving: isBoardMoving
    };
    
    io.emit('gameState', state);

}, 1000 / FPS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
