const WEB_APP_URL = "https://dashboardhtrading.onrender.com/get-indicators";

let macdChart = null, adxChart = null;
let isMuted = false, alertThreshold = 100, lastAlertTime = 0;
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let lastDelta = null;
let lastHistSign = null;
let currentPrice = 0;
let entryData = { price: 0, type: null };

// --- INICIALIZACIÓN Y ADAPTACIÓN LOCALSTORAGE ---
function initAlertControls() {
    const thInput = document.getElementById('alert_th');
    const muteBtn = document.getElementById('mute_btn');

    // Recuperar datos de localStorage (Compatibilidad Web)
    const savedTh = localStorage.getItem('h_th');
    const savedMute = localStorage.getItem('h_mute');

    if (savedTh) {
        alertThreshold = parseFloat(savedTh);
        thInput.value = savedTh;
    }
    if (savedMute !== null) {
        isMuted = savedMute === 'true';
        muteBtn.textContent = isMuted ? '🔇' : '🔊';
        muteBtn.style.color = isMuted ? '#ff4d4d' : '#00ff88';
    }

    thInput.oninput = (e) => {
        alertThreshold = parseFloat(e.target.value) || 0;
        localStorage.setItem('h_th', e.target.value);
    };

    muteBtn.onclick = () => {
        isMuted = !isMuted;
        localStorage.setItem('h_mute', isMuted);
        muteBtn.textContent = isMuted ? '🔇' : '🔊';
        muteBtn.style.color = isMuted ? '#ff4d4d' : '#00ff88';
    };
}
initAlertControls();

// --- LÓGICA DE DASHBOARD ---
async function updateDashboard() {
    const statusDot = document.getElementById('status');
    try {
    const response = await fetch(WEB_APP_URL);
    const allData = await response.json(); 
    if (!allData || allData.length < 2) return;

    const current = allData[0];
    const previous = allData[1];

    // MODIFICACIÓN AQUÍ: Verificamos que sea un dato válido y no el marcador inicial "--"
    if (current.deltaLong && current.deltaLong !== "--") {
        const deltaEl = document.getElementById('delta_val');
        const container = document.getElementById('delta-container'); 
        
        const lVal = parseCoinGlassValue(current.deltaLong);
        const sVal = parseCoinGlassValue(current.deltaShort);
        const delta = lVal - sVal;
            
            // Actualizar textos
            let dDisp = Math.abs(delta) >= 1000 ? (delta/1000).toFixed(2) + "B" : delta.toFixed(1) + "M";
            deltaEl.textContent = (delta >= 0 ? "+" : "") + dDisp;
            document.getElementById('long-valor').textContent = current.deltaLong;
            document.getElementById('short-valor').textContent = current.deltaShort;

            // --- LÓGICA DE ALERTA ---
            if (Math.abs(delta) >= alertThreshold && alertThreshold > 0) {
                // Cambiamos fondo y bordes
                container.style.background = delta >= 0 ? "#003d21" : "#3d0000"; 
                container.style.border = "2px solid #fff"; 
                deltaEl.style.color = "#fff"; // Texto blanco para que resalte en la alerta

                if (!isMuted && (Date.now() - lastAlertTime > 15000)) {
                    sonarNotificacion(delta >= 0 ? 'LONG' : 'SHORT');
                    lastAlertTime = Date.now();
                }
            } else {
                // Volvemos al estado normal
                container.style.background = "#1e222d"; 
                container.style.border = "none";
                container.style.borderLeft = "4px solid #f0b90b"; // Mantenemos tu estilo original
                deltaEl.style.color = delta >= 0 ? "#00ff88" : "#ff4d4d";
            }
        }

        // Resto de indicadores
        checkMACDAlerts(current, previous);
        updateStrategyUI(current);

        document.getElementById('adx_vals').textContent = 
            `${Number(current.adx).toFixed(1)} | ${Number(current.dmiPlus).toFixed(1)} | ${Number(current.dmiMinus).toFixed(1)}`;
        
        document.getElementById('macd_full_vals').textContent = 
            `${Number(current.histogram).toFixed(2)} | ${Number(current.macdLine).toFixed(2)} | ${Number(current.signalLine).toFixed(2)}`;
        
        const revData = [...allData].reverse();
        renderCharts(revData, revData.map(d => {
            const date = new Date(d.tiempo);
            return isNaN(date) ? "" : date.getHours() + ":" + String(date.getMinutes()).padStart(2, '0');
        }));

        statusDot.style.color = '#00ff88';
    } catch (e) { 
        console.error("Error en Dashboard:", e);
        statusDot.style.color = '#ff4d4d'; 
    }
}
// NUEVA FUNCIÓN: Alerta de Cruce de MACD
function checkMACDAlerts(curr, prev) {
    const signalEl = document.getElementById('main-signal');
    const currentSign = Math.sign(curr.histogram);
    const prevSign = Math.sign(prev.histogram);

    if (lastHistSign !== null && currentSign !== prevSign) {
        const esLong = currentSign > 0;
        triggerFlash('main-signal', esLong ? "#00ff88" : "#ff4d4d");
        
        const deltaVal = parseFloat(document.getElementById('delta_val').textContent) || 0;
        if (curr.adx > 18 || Math.abs(deltaVal) > alertThreshold) {
            sonarNotificacion(esLong ? 'LONG' : 'SHORT');
        }
    }
    lastHistSign = currentSign;

    const gap = Math.abs(curr.macdLine - curr.signalLine);
    if (gap < 0.12) {
        signalEl.style.border = "2px solid #f0b90b";
        signalEl.classList.add('blink-border');
    } else {
        signalEl.style.border = "none";
        signalEl.classList.remove('blink-border');
    }
}

function triggerFlash(elId, color) {
    const el = document.getElementById(elId);
    el.style.boxShadow = `0 0 20px ${color}`;
    setTimeout(() => { el.style.boxShadow = "none"; }, 500);
}

function updateStrategyUI(latest) {
    const signalEl = document.getElementById('main-signal');
    const adxTag = document.getElementById('strength-tag');
    const isStrong = latest.adx > 24;
    const histUp = latest.histogram > 0;
    const dmiBull = latest.dmiPlus > latest.dmiMinus;

    adxTag.textContent = `ADX: ${Number(latest.adx).toFixed(1)}`;
    adxTag.className = isStrong ? 'text-green' : '';

    if (isStrong && histUp && dmiBull) {
        signalEl.textContent = "POSIBLE LONG";
        signalEl.style.background = "rgba(0, 255, 136, 0.2)";
        signalEl.style.color = "#00ff88";
    } else if (isStrong && !histUp && !dmiBull) {
        signalEl.textContent = "POSIBLE SHORT";
        signalEl.style.background = "rgba(255, 77, 77, 0.2)";
        signalEl.style.color = "#ff4d4d";
    } else {
        signalEl.textContent = "ESPERANDO...";
        signalEl.style.background = "#333";
        signalEl.style.color = "#fff";
    }
}

// --- GRÁFICOS (CHART.JS) ---
function renderCharts(data, labels) {
    const opt = { 
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false } },
        scales: { 
            x: { display: false }, 
            y: { grid: { color: '#2a2e39' }, ticks: { color: '#888', font: { size: 8 } } } 
        }
    };

    const ctxM = document.getElementById('macdChart').getContext('2d');
    const hD = data.map(d => Number(d.histogram));
    
    if (!macdChart) {
        macdChart = new Chart(ctxM, {
            data: {
                labels,
                datasets: [
                    { type: 'bar', data: hD, backgroundColor: hD.map(v => v >= 0 ? '#00ff88' : '#ff4d4d') },
                    { type: 'line', data: data.map(d => d.macdLine), borderColor: '#2196f3', borderWidth: 1.5, pointRadius: 0 },
                    { type: 'line', data: data.map(d => d.signalLine), borderColor: '#f0b90b', borderWidth: 1.5, pointRadius: 0 }
                ]
            },
            options: opt
        });
    } else {
        macdChart.data.labels = labels;
        macdChart.data.datasets[0].data = hD;
        macdChart.data.datasets[0].backgroundColor = hD.map(v => v >= 0 ? '#00ff88' : '#ff4d4d');
        macdChart.data.datasets[1].data = data.map(d => d.macdLine);
        macdChart.data.datasets[2].data = data.map(d => d.signalLine);
        macdChart.update('none');
    }

    const ctxA = document.getElementById('adxChart').getContext('2d');
    if (!adxChart) {
        adxChart = new Chart(ctxA, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { data: data.map(d => d.adx), borderColor: '#f0b90b', borderWidth: 2, pointRadius: 0 },
                    { data: data.map(d => d.dmiPlus), borderColor: '#00ff88', borderWidth: 1, pointRadius: 0, borderDash: [2, 2] },
                    { data: data.map(d => d.dmiMinus), borderColor: '#ff4d4d', borderWidth: 1, pointRadius: 0, borderDash: [2, 2] }
                ]
            },
            options: { ...opt, scales: { y: { min: 0, max: 60 } } }
        });
    } else {
        adxChart.data.labels = labels;
        adxChart.data.datasets[0].data = data.map(d => d.adx);
        adxChart.data.datasets[1].data = data.map(d => d.dmiPlus);
        adxChart.data.datasets[2].data = data.map(d => d.dmiMinus);
        adxChart.update('none');
    }
}

// --- LOGICA PRECIO Y PNL ---
async function updateLivePrice() {
    try {
        const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
        const data = await response.json();
        currentPrice = parseFloat(data.price);
        document.getElementById('live-price').textContent = currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2 });
        if (entryData.type) calculatePnL();
    } catch (e) { console.error("Error Binance:", e); }
}

function calculatePnL() {
    if (!entryData.price) return;
    let pnl = ((entryData.type === 'LONG' ? (currentPrice - entryData.price) : (entryData.price - currentPrice)) / entryData.price) * 100;
    
    const pnlEl = document.getElementById('pnl-val');
    pnlEl.textContent = (pnl >= 0 ? "+" : "") + (pnl * 20).toFixed(2) + "%"; // Factor x20 incluido
    pnlEl.style.color = pnl >= 0 ? "#00ff88" : "#ff4d4d";
}

document.getElementById('btn-long').onclick = () => saveTrade('LONG');
document.getElementById('btn-short').onclick = () => saveTrade('SHORT');
document.getElementById('btn-clear').onclick = () => {
    localStorage.removeItem('active_trade');
    entryData = { price: 0, type: null };
    document.getElementById('pnl-display').style.display = 'none';
};

function saveTrade(type) {
    entryData = { price: currentPrice, type: type };
    localStorage.setItem('active_trade', JSON.stringify(entryData));
    showTradeUI();
}

function showTradeUI() {
    document.getElementById('pnl-display').style.display = 'block';
    const info = document.getElementById('entry-info');
    info.textContent = `${entryData.type} @ ${entryData.price.toFixed(2)}`;
    info.style.color = entryData.type === 'LONG' ? '#00ff88' : '#ff4d4d';
}

// Cargar trade guardado
const savedTrade = localStorage.getItem('active_trade');
if (savedTrade) {
    entryData = JSON.parse(savedTrade);
    showTradeUI();
}

// --- AUDIO ---
function sonarNotificacion(tipo) {
    if (isMuted) return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        const ahora = audioCtx.currentTime;

        if (tipo === 'LONG') {
            osc.frequency.setValueAtTime(440, ahora);
            osc.frequency.exponentialRampToValueAtTime(880, ahora + 0.2);
        } else {
            osc.frequency.setValueAtTime(880, ahora);
            osc.frequency.exponentialRampToValueAtTime(440, ahora + 0.2);
        }
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.0001, ahora + 0.5);
        osc.stop(ahora + 0.5);
    } catch(e) {}
}

// --- DELTA (Simulado en Web o vacío) ---
// Nota: El Delta en la web no se actualizará automáticamente 
// a menos que abras la pestaña de CoinGlass.
function updateDeltaDisplay() {
    const savedDelta = localStorage.getItem('btcDeltaData');
    if (savedDelta) {
        const data = JSON.parse(savedDelta);
        const lVal = parseCoinGlassValue(data.lStr);
        const sVal = parseCoinGlassValue(data.sStr);
        const delta = lVal - sVal;
        
        document.getElementById('delta_val').textContent = (delta >= 0 ? "+" : "") + (delta/1000).toFixed(2) + "B";
        document.getElementById('long-valor').textContent = data.lStr;
        document.getElementById('short-valor').textContent = data.sStr;
    }
}

function parseCoinGlassValue(str) {
    if(!str) return 0;
    const num = parseFloat(str.replace(/[^0-9.]/g, ''));
    return str.includes('B') ? num * 1000 : num;
}

// --- INTERVALOS ---
setInterval(updateDashboard, 1500);
setInterval(updateLivePrice, 2000);
setInterval(updateDeltaDisplay, 5000);
updateLivePrice();
updateDashboard();
