const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxTBJ0BC4F25dSqrtEKfgLovvFp3IVZGh_Sgbr6_BS-EjTPREba5jC7j1Ryfm28dv_hJw/exec?type=json";

let macdChart = null, adxChart = null;
let isMuted = false, alertThreshold = 100, lastAlertTime = 0;
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let lastDelta = null;
let lastHistSign = null;
let currentPrice = 0;
let entryData = { price: 0, type: null };

// --- INICIALIZACIÓN ---
// --- NUEVA LÓGICA DE CONFIGURACIÓN ---
function initAlertControls() {
    const thInput = document.getElementById('alert_th');
    const muteBtn = document.getElementById('mute_btn');

    // Cargar valores guardados
    chrome.storage.local.get(['h_th', 'h_mute'], (res) => {
        if (res.h_th) {
            alertThreshold = parseFloat(res.h_th);
            thInput.value = res.h_th;
        }
        if (res.h_mute !== undefined) {
            isMuted = res.h_mute;
            muteBtn.textContent = isMuted ? '🔇' : '🔊';
            muteBtn.style.color = isMuted ? '#ff4d4d' : '#00ff88';
        }
    });

    // Guardar al cambiar
    thInput.oninput = (e) => {
        alertThreshold = parseFloat(e.target.value) || 0;
        chrome.storage.local.set({ 'h_th': e.target.value });
    };

    muteBtn.onclick = () => {
        isMuted = !isMuted;
        chrome.storage.local.set({ 'h_mute': isMuted });
        muteBtn.textContent = isMuted ? '🔇' : '🔊';
        muteBtn.style.color = isMuted ? '#ff4d4d' : '#00ff88';
    };
}
initAlertControls();

async function updateDashboard() {
    const statusDot = document.getElementById('status');
    try {
        const response = await fetch(WEB_APP_URL, { redirect: 'follow' });
        const allData = await response.json(); 
        if (!allData || allData.length < 2) return;

        const current = allData[0];
        const previous = allData[1];
        
        // 1. ALERTAS DE CRUCE DE MACD
        checkMACDAlerts(current, previous);

        // 2. ACTUALIZAR UI GENERAL
        updateStrategyUI(current);

        // 3. TABLA DE DATOS
        document.getElementById('adx_vals').textContent = 
            `${Number(current.adx).toFixed(1)} | ${Number(current.dmiPlus).toFixed(1)} | ${Number(current.dmiMinus).toFixed(1)}`;
        
        const macdFullEl = document.getElementById('macd_full_vals');
        macdFullEl.textContent = 
            `${Number(current.histogram).toFixed(2)} | ${Number(current.macdLine).toFixed(2)} | ${Number(current.signalLine).toFixed(2)}`;
        
        // Gráficos
        const revData = [...allData].reverse();
        renderCharts(revData, revData.map(d => {
            const date = new Date(d.tiempo);
            return isNaN(date) ? "" : date.getHours() + ":" + String(date.getMinutes()).padStart(2, '0');
        }));

        statusDot.style.color = '#00ff88';
    } catch (e) { 
        statusDot.style.color = '#ff4d4d'; 
    }
}


// NUEVA FUNCIÓN: Alerta de Cruce de MACD
function checkMACDAlerts(curr, prev) {
    const signalEl = document.getElementById('main-signal');
    const currentSign = Math.sign(curr.histogram);
    const prevSign = Math.sign(prev.histogram);

    // 1. Detección de Cruce Real
    if (lastHistSign !== null && currentSign !== prevSign) {
        const esLong = currentSign > 0;
        const alertColor = esLong ? "#00ff88" : "#ff4d4d";
        
        triggerFlash('main-signal', alertColor);
        
        // --- FILTRO DE AUDIO INTELIGENTE ---
        // Solo suena si el ADX es > 18 (empezando tendencia) 
        // o si el Delta ya superó tu umbral de alerta.
        const deltaAbs = Math.abs(parseFloat(document.getElementById('delta_val').textContent) || 0);
        
        if (curr.adx > 18 || deltaAbs > alertThreshold) {
            sonarNotificacion(esLong ? 'LONG' : 'SHORT');
            console.log("🔊 Alerta sonora: Cruce con fuerza.");
        } else {
            console.log("🔇 Cruce detectado pero ADX muy bajo (Mercado lateral).");
        }
    }
    lastHistSign = currentSign;

    // 2. Alerta de Proximidad Visual (se mantiene siempre para estar alerta)
    const gap = Math.abs(curr.macdLine - curr.signalLine);
    if (gap < 0.12) {
        signalEl.style.border = "2px solid #f0b90b";
        signalEl.classList.add('blink-border');
    } else {
        signalEl.style.border = "none";
        signalEl.classList.remove('blink-border');
    }
}



// Función auxiliar de parpadeo
function triggerFlash(elId, color) {
    const el = document.getElementById(elId);
    el.style.transition = "all 0.1s ease";
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

function renderCharts(data, labels) {
    const opt = { 
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false } },
        scales: { 
            x: { display: false }, 
            y: { grid: { color: '#2a2e39' }, ticks: { color: '#888', font: { size: 8 } } } 
        }
    };

    // 1. GRÁFICO MACD (Cruces + Histograma)
    const ctxM = document.getElementById('macdChart').getContext('2d');
    const hD = data.map(d => Number(d.histogram));
    
    if (!macdChart) {
        macdChart = new Chart(ctxM, {
            data: {
                labels,
                datasets: [
                    { type: 'bar', label: 'Hist', data: hD, backgroundColor: hD.map(v => v >= 0 ? '#00ff88' : '#ff4d4d'), order: 2 },
                    { type: 'line', label: 'MACD', data: data.map(d => d.macdLine), borderColor: '#2196f3', borderWidth: 1.5, pointRadius: 0, order: 1 },
                    { type: 'line', label: 'Signal', data: data.map(d => d.signalLine), borderColor: '#f0b90b', borderWidth: 1.5, pointRadius: 0, order: 1 }
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

    // 2. GRÁFICO ADX & DMI
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
            options: { ...opt, scales: { y: { min: 0, max: 60, ticks: { stepSize: 10 } } } }
        });
    } else {
        adxChart.data.labels = labels;
        adxChart.data.datasets[0].data = data.map(d => d.adx);
        adxChart.data.datasets[1].data = data.map(d => d.dmiPlus);
        adxChart.data.datasets[2].data = data.map(d => d.dmiMinus);
        adxChart.update('none');
    }
}

// --- LOGICA DELTA (Mantenida igual ya que viene de chrome.storage) ---
// RESTAURACIÓN: Alerta Visual de Delta
// --- ACTUALIZA TU FUNCIÓN updateDeltaDisplay ---
async function updateDeltaDisplay() {
    chrome.storage.local.get(["btcDeltaData"], (result) => {
        if (result.btcDeltaData) {
            const { lStr, sStr } = result.btcDeltaData;
            const lVal = parseCoinGlassValue(lStr);
            const sVal = parseCoinGlassValue(sStr);
            const delta = lVal - sVal;

            const deltaEl = document.getElementById('delta_val');
            const container = document.getElementById('delta-container');
            const longV = document.getElementById('long-valor');
            const shortV = document.getElementById('short-valor');   

            let dDisp = Math.abs(delta) >= 1000 ? (delta/1000).toFixed(2) + "B" : delta.toFixed(1) + "M";
            deltaEl.textContent = (delta >= 0 ? "+" : "") + dDisp;
            longV.textContent = Math.abs(lVal) >= 1000 ? (lVal/1000).toFixed(2) + "B" : lVal.toFixed(1) + "M";
            shortV.textContent = Math.abs(sVal) >= 1000 ? (sVal/1000).toFixed(2) + "B" : sVal.toFixed(1) + "M";
            longV.style.color = "#00ff88";
            shortV.style.color = "#ff4d4d";

            // Lógica de Alarma Visual y Sonora
            if (Math.abs(delta) >= alertThreshold && alertThreshold > 0) {
                container.style.background = delta >= 0 ? "#003d21" : "#3d0000";
                container.style.border = "2px solid #fff";
                deltaEl.style.color = "#fff";

                if (!isMuted && (Date.now() - lastAlertTime > 15000)) {
                    sonarNotificacion(delta >= 0 ? 'LONG' : 'SHORT');
                    lastAlertTime = Date.now();
                }
            } else {
                container.style.background = "#1e222d";
                container.style.border = "none";
                container.style.borderLeft = "4px solid #f0b90b";
                deltaEl.style.color = delta >= 0 ? "#00ff88" : "#ff4d4d";
            }
        }
    });
}

function sonarNotificacion(tipo) {
    if (isMuted) return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        const ahora = audioCtx.currentTime;

        if (tipo === 'LONG') {
            // Tono ascendente heroico
            osc.frequency.setValueAtTime(440, ahora);
            osc.frequency.exponentialRampToValueAtTime(880, ahora + 0.2);
            gain.gain.setValueAtTime(0.1, ahora);
        } else if (tipo === 'SHORT') {
            // Tono descendente de alerta
            osc.frequency.setValueAtTime(880, ahora);
            osc.frequency.exponentialRampToValueAtTime(440, ahora + 0.2);
            gain.gain.setValueAtTime(0.1, ahora);
        } else if (tipo === 'ADX_STRONG') {
            // Doble pitido rápido (fuerza de tendencia)
            osc.frequency.setValueAtTime(660, ahora);
            gain.gain.setValueAtTime(0.05, ahora);
            osc.start();
            osc.stop(ahora + 0.1);
            return; // Salimos para no ejecutar el stop general
        }

        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.0001, ahora + 0.5);
        osc.stop(ahora + 0.5);
    } catch(e) { console.log("Audio bloqueado"); }
}

// --- FUNCIONES AUXILIARES ---
function parseCoinGlassValue(str) {
    if(!str) return 0;
    const num = parseFloat(str.replace(/[^0-9.]/g, ''));
    return str.includes('B') ? num * 1000 : num;
}


/* para precio de binance */
// 1. Obtener precio real de Binance
async function updateLivePrice() {
    try {
        const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
        const data = await response.json();
        currentPrice = parseFloat(data.price);
        document.getElementById('live-price').textContent = currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2 });
        
        if (entryData.type) calculatePnL();
    } catch (e) { console.error("Error Binance:", e); }
}

// 2. Calcular PnL
function calculatePnL() {
    if (!entryData.price) return;
    let pnl = 0;
    if (entryData.type === 'LONG') {
        pnl = ((currentPrice - entryData.price) / entryData.price) * 100;
    } else {
        pnl = ((entryData.price - currentPrice) / entryData.price) * 100;
    }
    
    const pnlEl = document.getElementById('pnl-val');
    pnlEl.textContent = (pnl >= 0 ? "+" : "") + pnl.toFixed(2)*20 + "%";
    pnlEl.style.color = pnl >= 0 ? "#00ff88" : "#ff4d4d";
}

// 3. Eventos de los botones (Agrégalos dentro de tu función de inicio o al final)
document.getElementById('btn-long').onclick = () => saveTrade('LONG');
document.getElementById('btn-short').onclick = () => saveTrade('SHORT');
document.getElementById('btn-clear').onclick = () => {
    chrome.storage.local.remove('active_trade');
    entryData = { price: 0, type: null };
    document.getElementById('pnl-display').style.display = 'none';
};

function saveTrade(type) {
    entryData = { price: currentPrice, type: type };
    chrome.storage.local.set({ 'active_trade': entryData });
    showTradeUI();
}

function showTradeUI() {
    document.getElementById('pnl-display').style.display = 'block';
    const info = document.getElementById('entry-info');
    info.textContent = `${entryData.type} @ ${entryData.price.toFixed(2)}`;
    info.style.color = entryData.type === 'LONG' ? '#00ff88' : '#ff4d4d';
}

// 4. Cargar datos al abrir el popup
chrome.storage.local.get(['active_trade'], (res) => {
    if (res.active_trade) {
        entryData = res.active_trade;
        showTradeUI();
    }
});

/* termina codigo para precio de binance*/




// --- EJECUCIÓN INICIAL ---
setInterval(updateDashboard, 15000); // Cada 15 seg
setInterval(updateDeltaDisplay, 2000);
setInterval(updateLivePrice, 3000);
updateLivePrice();
updateDashboard();
updateDeltaDisplay();
