/**
 * WAREHOUSE ORDER FULFILLMENT SIMULATION SYSTEM
 * Core Application Engine
 */

// Global State
let isPaused = false;
let simSpeed = 1;
let soundEnabled = true;
let isInitialized = false;

// Data Repositories
let orders = [];
let inventory = [
    { id: 'SKU-101', name: 'Wireless Headphones', stock: 42, max: 50, shelf: 'A1', x: 120, y: 100 },
    { id: 'SKU-102', name: 'Smart Mechanical Watch', stock: 18, max: 40, shelf: 'A2', x: 220, y: 100 },
    { id: 'SKU-103', name: 'Ergonomic Gaming Mouse', stock: 8, max: 30, shelf: 'B1', x: 320, y: 100 },
    { id: 'SKU-104', name: 'Mechanical RGB Keyboard', stock: 25, max: 35, shelf: 'B2', x: 420, y: 100 },
    { id: 'SKU-105', name: 'USB-C Fast Charger Hub', stock: 60, max: 80, shelf: 'C1', x: 120, y: 260 },
    { id: 'SKU-106', name: '4K Ultra HD Monitor', stock: 5, max: 20, shelf: 'C2', x: 220, y: 260 },
    { id: 'SKU-107', name: 'Noise-Cancel Earbuds', stock: 30, max: 50, shelf: 'D1', x: 320, y: 260 },
    { id: 'SKU-108', name: 'Portable Power Bank', stock: 12, max: 40, shelf: 'D2', x: 420, y: 260 }
];

// Map Layout Locations
const PACKING_BAY = { x: 550, y: 340, name: 'Packing Bench' };
const DISPATCH_DOCK = { x: 700, y: 340, name: 'Dispatch Bay' };
const AGV_DEPOT = { x: 60, y: 340, name: 'AGV Depot' };

// AGV Fleet state
let agvs = [
    { id: 'AGV-01', x: 60, y: 340, state: 'IDLE', targetX: 60, targetY: 340, orderId: null, progress: 0 },
    { id: 'AGV-02', x: 90, y: 340, state: 'IDLE', targetX: 90, targetY: 340, orderId: null, progress: 0 },
    { id: 'AGV-03', x: 120, y: 340, state: 'IDLE', targetX: 120, targetY: 340, orderId: null, progress: 0 },
    { id: 'AGV-04', x: 150, y: 340, state: 'IDLE', targetX: 150, targetY: 340, orderId: null, progress: 0 }
];

// Metrics
let totalOrdersCount = 0;
let dispatchedCount = 0;
let velocityData = Array(15).fill(0);
let velocityChart = null;

// Audio Context Web API setup
let audioCtx = null;
function playSound(type) {
    if (!soundEnabled) return;
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        const now = audioCtx.currentTime;
        if (type === 'newOrder') {
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.linearRampToValueAtTime(0.01, now + 0.15);
            osc.start(now);
            osc.stop(now + 0.15);
        } else if (type === 'dispatch') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(523.25, now);
            osc.frequency.setValueAtTime(659.25, now + 0.1);
            osc.frequency.setValueAtTime(783.99, now + 0.2);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.linearRampToValueAtTime(0.01, now + 0.35);
            osc.start(now);
            osc.stop(now + 0.35);
        }
    } catch(e){}
}

// Canvas Initialization
const canvas = document.getElementById('warehouseCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;

function resizeCanvas() {
    if (!canvas) return;
    const parent = canvas.parentElement;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
}
window.addEventListener('resize', resizeCanvas);

// --- SIMULATION LOOP & LOGIC ---

function initChart() {
    const chartCtx = document.getElementById('velocityChart');
    if (!chartCtx) return;
    velocityChart = new Chart(chartCtx.getContext('2d'), {
        type: 'line',
        data: {
            labels: Array(15).fill(''),
            datasets: [{
                label: 'Orders/Min',
                data: velocityData,
                borderColor: '#6366f1',
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false },
                y: { 
                    grid: { color: 'rgba(51, 65, 85, 0.4)' },
                    ticks: { color: '#94a3b8', font: { size: 10 } },
                    beginAtZero: true 
                }
            }
        }
    });
}

// Order Generation
function generateRandomOrder() {
    if (inventory.length === 0) return;
    totalOrdersCount++;
    const randomItem = inventory[Math.floor(Math.random() * inventory.length)];
    const priorities = ['Standard', 'Standard', 'Express', 'Critical Rush'];
    const priority = priorities[Math.floor(Math.random() * priorities.length)];
    
    const order = {
        id: `ORD-${Math.floor(1000 + Math.random() * 9000)}`,
        customer: ['Acme Corp', 'Apex Logistics', 'Cyberdyne', 'Stark Ind', 'Wayne Ent'][Math.floor(Math.random() * 5)],
        item: randomItem,
        qty: Math.floor(Math.random() * 2) + 1,
        priority: priority,
        status: 'PENDING',
        timestamp: Date.now(),
        agvId: null,
        boxSize: null
    };

    orders.unshift(order);
    playSound('newOrder');
    updateUI();
}

// Assign Orders to AGVs
function assignOrdersToAGVs() {
    const pendingOrders = orders.filter(o => o.status === 'PENDING');
    if (pendingOrders.length === 0) return;

    agvs.forEach(agv => {
        if (agv.state === 'IDLE' && pendingOrders.length > 0) {
            const order = pendingOrders.shift();
            
            if (order.item.stock >= order.qty) {
                order.item.stock -= order.qty;
            } else {
                return;
            }

            order.status = 'PICKING';
            order.agvId = agv.id;

            agv.state = 'MOVING_TO_ITEM';
            agv.orderId = order.id;
            agv.targetX = order.item.x;
            agv.targetY = order.item.y;
        }
    });
}

// AGV Movement & State Machine Tick
function updateAGVs() {
    const speed = 2.5 * simSpeed;

    agvs.forEach(agv => {
        if (agv.state === 'IDLE') return;

        const dx = agv.targetX - agv.x;
        const dy = agv.targetY - agv.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > speed) {
            agv.x += (dx / dist) * speed;
            agv.y += (dy / dist) * speed;
        } else {
            agv.x = agv.targetX;
            agv.y = agv.targetY;

            if (agv.state === 'MOVING_TO_ITEM') {
                agv.state = 'RETURNING_TO_PACK';
                agv.targetX = PACKING_BAY.x;
                agv.targetY = PACKING_BAY.y;
            } 
            else if (agv.state === 'RETURNING_TO_PACK') {
                const order = orders.find(o => o.id === agv.orderId);
                if (order) {
                    order.status = 'PACKING';
                }
                agv.state = 'RETURNING_DEPOT';
                agv.orderId = null;
                agv.targetX = AGV_DEPOT.x + (agvs.indexOf(agv) * 30);
                agv.targetY = AGV_DEPOT.y;
            }
            else if (agv.state === 'RETURNING_DEPOT') {
                agv.state = 'IDLE';
            }
        }
    });
}

// Render 2D Canvas Warehouse Floor
function drawWarehouse() {
    const canvasEl = document.getElementById('warehouseCanvas');
    if (!canvasEl) return;
    const canvasCtx = canvasEl.getContext('2d');
    const w = canvasEl.width;
    const h = canvasEl.height;
    canvasCtx.clearRect(0, 0, w, h);

    canvasCtx.strokeStyle = '#1e293b';
    canvasCtx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < w; x += gridSize) {
        canvasCtx.beginPath(); canvasCtx.moveTo(x, 0); canvasCtx.lineTo(x, h); canvasCtx.stroke();
    }
    for (let y = 0; y < h; y += gridSize) {
        canvasCtx.beginPath(); canvasCtx.moveTo(0, y); canvasCtx.lineTo(w, y); canvasCtx.stroke();
    }

    agvs.forEach(agv => {
        if (agv.state !== 'IDLE') {
            canvasCtx.beginPath();
            canvasCtx.setLineDash([4, 4]);
            canvasCtx.strokeStyle = '#6366f1';
            canvasCtx.lineWidth = 1.5;
            canvasCtx.moveTo(agv.x, agv.y);
            canvasCtx.lineTo(agv.targetX, agv.targetY);
            canvasCtx.stroke();
            canvasCtx.setLineDash([]);
        }
    });

    inventory.forEach(item => {
        const isLow = item.stock <= 10;
        canvasCtx.fillStyle = isLow ? '#7f1d1d' : '#1e293b';
        canvasCtx.strokeStyle = isLow ? '#ef4444' : '#3b82f6';
        canvasCtx.lineWidth = 2;

        canvasCtx.beginPath();
        canvasCtx.roundRect(item.x - 30, item.y - 20, 60, 40, 6);
        canvasCtx.fill();
        canvasCtx.stroke();

        canvasCtx.fillStyle = '#94a3b8';
        canvasCtx.font = '10px sans-serif';
        canvasCtx.textAlign = 'center';
        canvasCtx.fillText(`${item.shelf} (${item.id})`, item.x, item.y - 5);
        
        canvasCtx.fillStyle = isLow ? '#f87171' : '#38bdf8';
        canvasCtx.font = 'bold 11px sans-serif';
        canvasCtx.fillText(`Stock: ${item.stock}`, item.x, item.y + 12);
    });

    canvasCtx.fillStyle = 'rgba(30, 41, 59, 0.6)';
    canvasCtx.strokeStyle = '#64748b';
    canvasCtx.lineWidth = 1.5;
    canvasCtx.beginPath(); canvasCtx.roundRect(40, 310, 140, 60, 8); canvasCtx.fill(); canvasCtx.stroke();
    canvasCtx.fillStyle = '#64748b'; canvasCtx.font = '10px sans-serif'; canvasCtx.fillText('AGV CHARGING BAY', 110, 345);

    canvasCtx.fillStyle = 'rgba(88, 28, 135, 0.3)';
    canvasCtx.strokeStyle = '#a855f7';
    canvasCtx.beginPath(); canvasCtx.roundRect(PACKING_BAY.x - 35, PACKING_BAY.y - 30, 70, 60, 8); canvasCtx.fill(); canvasCtx.stroke();
    canvasCtx.fillStyle = '#c084fc'; canvasCtx.font = 'bold 10px sans-serif'; canvasCtx.fillText('PACKING QC', PACKING_BAY.x, PACKING_BAY.y + 4);

    canvasCtx.fillStyle = 'rgba(6, 78, 59, 0.3)';
    canvasCtx.strokeStyle = '#10b981';
    canvasCtx.beginPath(); canvasCtx.roundRect(DISPATCH_DOCK.x - 35, DISPATCH_DOCK.y - 30, 70, 60, 8); canvasCtx.fill(); canvasCtx.stroke();
    canvasCtx.fillStyle = '#34d399'; canvasCtx.font = 'bold 10px sans-serif'; canvasCtx.fillText('DISPATCH', DISPATCH_DOCK.x, DISPATCH_DOCK.y + 4);

    agvs.forEach(agv => {
        canvasCtx.save();
        canvasCtx.translate(agv.x, agv.y);

        canvasCtx.fillStyle = '#f59e0b';
        canvasCtx.beginPath(); canvasCtx.arc(0, 0, 14, 0, Math.PI * 2); canvasCtx.fill();
        canvasCtx.strokeStyle = '#fff'; canvasCtx.lineWidth = 2; canvasCtx.stroke();

        canvasCtx.fillStyle = agv.state === 'IDLE' ? '#94a3b8' : '#22c55e';
        canvasCtx.beginPath(); canvasCtx.arc(0, 0, 4, 0, Math.PI * 2); canvasCtx.fill();

        canvasCtx.fillStyle = '#ffffff';
        canvasCtx.font = '9px sans-serif';
        canvasCtx.fillText(agv.id, 0, -18);

        canvasCtx.restore();
    });
}

// --- Product Management (Add / Delete) ---
function openAddProductModal() {
    const modal = document.getElementById('addProductModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

function closeAddProductModal() {
    const modal = document.getElementById('addProductModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    const nameEl = document.getElementById('newProdName');
    const skuEl = document.getElementById('newProdSku');
    const shelfEl = document.getElementById('newProdShelf');
    if (nameEl) nameEl.value = '';
    if (skuEl) skuEl.value = '';
    if (shelfEl) shelfEl.value = '';
}

function addNewProduct(e) {
    e.preventDefault();
    const name = document.getElementById('newProdName').value.trim();
    const id = document.getElementById('newProdSku').value.trim();
    const shelf = document.getElementById('newProdShelf').value.trim();
    const stock = parseInt(document.getElementById('newProdStock').value);
    const max = parseInt(document.getElementById('newProdMax').value);

    if (inventory.some(item => item.id === id)) {
        alert('SKU ID already exists! Please use a unique ID.');
        return;
    }

    const newX = Math.floor(80 + Math.random() * 380);
    const newY = Math.floor(80 + Math.random() * 200);

    inventory.push({
        id: id,
        name: name,
        stock: stock,
        max: max,
        shelf: shelf,
        x: newX,
        y: newY
    });

    closeAddProductModal();
    updateUI();
}

function deleteProduct(skuId) {
    if (confirm(`Are you sure you want to remove product ${skuId} from inventory?`)) {
        inventory = inventory.filter(item => item.id !== skuId);
        updateUI();
    }
}

// Update Kanban Swimlane UI & Metrics
function updateUI() {
    const statTotal = document.getElementById('statTotal');
    if (statTotal) statTotal.innerText = totalOrdersCount;

    const pickingOrders = orders.filter(o => o.status === 'PICKING');
    const statPicking = document.getElementById('statPicking');
    if (statPicking) statPicking.innerText = pickingOrders.length;

    const statDispatched = document.getElementById('statDispatched');
    if (statDispatched) statDispatched.innerText = dispatchedCount;

    const activeAgvs = agvs.filter(a => a.state !== 'IDLE').length;
    const statActiveAgvs = document.getElementById('statActiveAgvs');
    const statFleetUtil = document.getElementById('statFleetUtil');
    if (statActiveAgvs) statActiveAgvs.innerText = `${activeAgvs}/4`;
    if (statFleetUtil) statFleetUtil.innerText = `${Math.round((activeAgvs / 4) * 100)}%`;

    const activeOrdersCountEl = document.getElementById('orderCountBadge');
    if (activeOrdersCountEl) {
        activeOrdersCountEl.innerText = `${orders.filter(o => o.status !== 'DISPATCHED').length} Active`;
    }

    const lanes = {
        PENDING: document.getElementById('lanePending'),
        PICKING: document.getElementById('lanePicking'),
        PACKING: document.getElementById('lanePacking'),
        DISPATCHED: document.getElementById('laneDispatched')
    };

    const counts = { PENDING: 0, PICKING: 0, PACKING: 0, DISPATCHED: 0 };
    Object.keys(lanes).forEach(k => {
        if (lanes[k]) lanes[k].innerHTML = '';
    });

    orders.slice(0, 25).forEach(order => {
        if (!lanes[order.status]) return;
        counts[order.status]++;
        const card = document.createElement('div');
        
        let priorityColor = 'bg-slate-700 text-slate-300';
        let borderClass = 'border-slate-700';
        if (order.priority === 'Express') { priorityColor = 'bg-amber-500/20 text-amber-300 border-amber-500/40'; }
        if (order.priority === 'Critical Rush') { priorityColor = 'bg-red-500/20 text-red-300 border-red-500/40'; borderClass = 'card-critical'; }

        card.className = `order-card bg-slate-800 p-2.5 rounded-lg border ${borderClass} shadow text-xs flex flex-col gap-1.5`;
        card.innerHTML = `
            <div class="flex justify-between items-center">
                <span class="font-bold text-slate-200">${order.id}</span>
                <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold border ${priorityColor}">${order.priority}</span>
            </div>
            <div class="text-slate-400 text-[11px]">
                Item: <span class="text-slate-200">${order.item ? order.item.name : 'Unknown'} (x${order.qty})</span>
            </div>
            <div class="flex justify-between items-center text-[10px] text-slate-500 pt-1 border-t border-slate-700/50">
                <span>Client: ${order.customer}</span>
                <span>${order.agvId ? `<i class="fa-solid fa-robot text-amber-400"></i> ${order.agvId}` : ''}</span>
            </div>
        `;
        lanes[order.status].appendChild(card);
    });

    const badgePending = document.getElementById('badgePending');
    const badgePicking = document.getElementById('badgePicking');
    const badgePacking = document.getElementById('badgePacking');
    const badgeDispatched = document.getElementById('badgeDispatched');
    if (badgePending) badgePending.innerText = counts.PENDING;
    if (badgePicking) badgePicking.innerText = counts.PICKING;
    if (badgePacking) badgePacking.innerText = counts.PACKING;
    if (badgeDispatched) badgeDispatched.innerText = counts.DISPATCHED;

    const invTable = document.getElementById('inventoryTableBody');
    if (invTable) {
        invTable.innerHTML = '';
        inventory.forEach(item => {
            const tr = document.createElement('tr');
            const isLow = item.stock <= 10;
            tr.className = isLow ? 'bg-red-500/10 border-b border-slate-700/50' : 'border-b border-slate-700/50';
            tr.innerHTML = `
                <td class="py-2 font-medium ${isLow ? 'text-red-400 font-bold' : 'text-slate-300'}">${item.name} <span class="text-[10px] text-slate-500 font-mono">(${item.id})</span></td>
                <td class="py-2 text-center font-mono text-slate-400">${item.shelf}</td>
                <td class="py-2 text-right font-bold ${isLow ? 'text-red-400' : 'text-slate-300'}">${item.stock} / ${item.max}</td>
                <td class="py-2 text-right space-x-1">
                    <button onclick="restockItem('${item.id}')" class="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-[10px] text-indigo-300 transition">Restock</button>
                    <button onclick="deleteProduct('${item.id}')" class="px-2 py-1 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded text-[10px] text-red-300 transition" title="Delete Product"><i class="fa-solid fa-trash"></i></button>
                </td>
            `;
            invTable.appendChild(tr);
        });
    }

    renderPackingDesk();
}

function renderPackingDesk() {
    const container = document.getElementById('packingDeskContainer');
    const packingOrder = orders.find(o => o.status === 'PACKING');
    const activeTag = document.getElementById('activePackingOrderTag');
    if (!container || !activeTag) return;

    if (!packingOrder) {
        activeTag.innerText = 'IDLE';
        activeTag.className = 'text-[10px] bg-slate-700 text-slate-400 px-2 py-0.5 rounded';
        container.innerHTML = `
            <i class="fa-solid fa-box-open text-2xl text-slate-600 mb-2"></i>
            <p>No order currently waiting at packing station.</p>
        `;
        return;
    }

    activeTag.innerText = `READY: ${packingOrder.id}`;
    activeTag.className = 'text-[10px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded border border-purple-500/30';

    container.innerHTML = `
        <div class="text-left space-y-3">
            <div class="bg-slate-800 p-2.5 rounded border border-purple-500/30">
                <div class="flex justify-between font-bold text-slate-200">
                    <span>${packingOrder.id}</span>
                    <span class="text-purple-400">${packingOrder.customer}</span>
                </div>
                <div class="text-slate-300 text-xs mt-1">Item: ${packingOrder.item ? packingOrder.item.name : 'Unknown'} (Qty: ${packingOrder.qty})</div>
            </div>

            <div class="space-y-1.5">
                <label class="block text-[11px] font-medium text-slate-400">Select Box Packaging Size:</label>
                <div class="grid grid-cols-3 gap-2">
                    <button onclick="selectBox('Small')" class="box-opt-btn p-2 border ${packingOrder.boxSize === 'Small' ? 'border-purple-500 bg-purple-500/20 text-purple-300' : 'border-slate-700 bg-slate-800 text-slate-400'} rounded text-center text-xs font-semibold">Small Box</button>
                    <button onclick="selectBox('Medium')" class="box-opt-btn p-2 border ${packingOrder.boxSize === 'Medium' ? 'border-purple-500 bg-purple-500/20 text-purple-300' : 'border-slate-700 bg-slate-800 text-slate-400'} rounded text-center text-xs font-semibold">Medium Box</button>
                    <button onclick="selectBox('Large')" class="box-opt-btn p-2 border ${packingOrder.boxSize === 'Large' ? 'border-purple-500 bg-purple-500/20 text-purple-300' : 'border-slate-700 bg-slate-800 text-slate-400'} rounded text-center text-xs font-semibold">Large Box</button>
                </div>
            </div>

            <button onclick="dispatchOrder('${packingOrder.id}')" ${!packingOrder.boxSize ? 'disabled' : ''} class="w-full py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:opacity-50 text-white font-bold rounded-lg shadow-lg text-xs transition flex items-center justify-center gap-2">
                <i class="fa-solid fa-print"></i> Generate Manifest & Dispatch
            </button>
        </div>
    `;
}

function selectBox(size) {
    const packingOrder = orders.find(o => o.status === 'PACKING');
    if (packingOrder) {
        packingOrder.boxSize = size;
        renderPackingDesk();
    }
}

function dispatchOrder(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (order) {
        order.status = 'DISPATCHED';
        dispatchedCount++;
        playSound('dispatch');

        if (typeof confetti === 'function') {
            confetti({
                particleCount: 40,
                spread: 60,
                origin: { x: 0.85, y: 0.7 }
            });
        }

        updateUI();
    }
}

function restockItem(skuId) {
    const item = inventory.find(i => i.id === skuId);
    if (item) {
        item.stock = item.max;
        updateUI();
    }
}

function restockAll() {
    inventory.forEach(i => i.stock = i.max);
    updateUI();
}

// User Controls
function toggleSimulation() {
    isPaused = !isPaused;
    const btn = document.getElementById('playPauseBtn');
    const icon = document.getElementById('playIcon');
    const text = document.getElementById('playText');
    if (!btn || !icon || !text) return;

    if (isPaused) {
        icon.className = 'fa-solid fa-play';
        text.innerText = 'Resume';
        btn.className = 'px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium text-xs flex items-center gap-1.5 transition';
    } else {
        icon.className = 'fa-solid fa-pause';
        text.innerText = 'Pause';
        btn.className = 'px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium text-xs flex items-center gap-1.5 transition';
    }
}

function setSpeed(spd) {
    simSpeed = spd;
    document.querySelectorAll('.speed-btn').forEach(b => {
        if (parseInt(b.dataset.speed) === spd) {
            b.className = 'speed-btn px-2.5 py-1 text-xs font-semibold rounded bg-slate-800 text-indigo-400 border border-slate-700';
        } else {
            b.className = 'speed-btn px-2.5 py-1 text-xs font-semibold rounded text-slate-300 hover:bg-slate-800';
        }
    });
}

function toggleSound() {
    soundEnabled = !soundEnabled;
    const icon = document.getElementById('soundIcon');
    if (icon) {
        icon.className = soundEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark text-red-400';
    }
}

// Main Simulation Loop Step
function loop() {
    if (!isPaused) {
        assignOrdersToAGVs();
        updateAGVs();
        drawWarehouse();
    }
    requestAnimationFrame(loop);
}

// Deferred Initialization Function (Called upon login)
function initDashboardSystem() {
    if (isInitialized) return;
    isInitialized = true;
    resizeCanvas();
    initChart();
    generateRandomOrder();
    generateRandomOrder();
    generateRandomOrder();
    loop();

    setInterval(() => {
        if (!isPaused && Math.random() < 0.6) {
            generateRandomOrder();
        }
    }, 4000);

    setInterval(() => {
        if (!isPaused) {
            const currentVelocity = (dispatchedCount / (performance.now() / 60000)).toFixed(1);
            const throughputEl = document.getElementById('throughputValue');
            if (throughputEl) throughputEl.innerText = `${currentVelocity} /m`;
            velocityData.shift();
            velocityData.push(parseFloat(currentVelocity));
            if (velocityChart) velocityChart.update();
        }
    }, 3000);
}
