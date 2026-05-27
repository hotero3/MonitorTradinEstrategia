const WEB_APP_URL = "https://dashboardhtrading.onrender.com/get-indicators";

let macdChart = null, adxChart = null;
let isMuted = false, alertThreshold = 100, lastAlertTime = 0;
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let lastDelta = null;
let lastHistSign = null;
let currentPrice = 0;
let entryData = JSON.parse(localStorage.getItem('active_trade')) || { price: 0, type: null, max: 0, min: 0 };
let isTradeActive = false;
let entryPrice = 0;
let maxReached = 0; 
let minReached = 0; 
let tradeType = ""; 

// --- INICIALIZACIÓN Y ADAPTACIÓN LOCALSTORAGE ---
function initAlertControls() {
    const thInput = document.getElementById('alert_th');
    const muteBtn = document.getElementById('mute_btn');

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

// --- CODIGO PARA MINIMO Y MAXIMO----
function startTradeTracking(type, currentPrice) {
    isTradeActive = true;
    tradeType = type;
    entryPrice = currentPrice;
    maxReached = currentPrice;
    minReached = currentPrice;

    console.log(`Trade ${type} iniciado en ${entryPrice}`);
    updateTradeUI(); 
}

// --- LÓGICA DE DASHBOARD ---
async function updateDashboard() {
    const statusDot = document.getElementById('status');
    try {
        const response = await fetch(WEB_APP_URL);
        const allData = await response.json(); 
        if (!allData || allData.length < 2) return;

        const current = allData[0];
        const previous = allData[1];

        // --- PROCESAMIENTO DEL RSI (CORREGIDO DE 'actual' A 'current') ---
        if (current.rsi !== undefined) {
            const rsiVal = Number(current.rsi); // <-- SOLUCIONADO: 'actual' cambiado a 'current'
            const rsiElement = document.getElementById('rsi-val');
            const rsiTextElement = document.getElementById('rsi-text');

            if (rsiElement && rsiTextElement) {
                rsiElement.textContent = rsiVal.toFixed(2);

                if (rsiVal >= 70) {
                    rsiTextElement.textContent = "Sobre compra";
                    rsiTextElement.style.color = "#35948E";
                    rsiElement.style.color = "#35948E";
                } else if (rsiVal >= 55) {
                    rsiTextElement.textContent = "Compra fuerte";
                    rsiTextElement.style.color = "#26a69a";
                    rsiElement.style.color = "#26a69a";
                } else if (rsiVal > 45 && rsiVal < 55) {
                    rsiTextElement.textContent = "Neutral";
                    rsiTextElement.style.color = "#f0b90b";
                    rsiElement.style.color = "#f0b90b";
                } else if (rsiVal <= 30) {
                    rsiTextElement.textContent = "Sobre venta";
                    rsiTextElement.style.color = "#ff4d4d";
                    rsiElement.style.color = "#ff4d4d";
                } else if (rsiVal <= 45) {
                    rsiTextElement.textContent = "Venta fuerte";
                    rsiTextElement.style.color = "#ff9800";
                    rsiElement.style.color = "#ff9800";
                }
            }
        }    

        // --- PROCESAMIENTO DEL DELTA ---
        if (current.deltaLong && current.deltaLong !== "--") {
            const deltaEl = document.getElementById('delta_val');
            const container = document.getElementById('delta-container'); 

            const lVal = parseCoinGlassValue(current.deltaLong);
            const sVal = parseCoinGlassValue(current.deltaShort);
            const delta = lVal - sVal;

            let dDisp = Math.abs(delta) >= 1000 ? (delta/1000).toFixed(2) + "B" : delta.toFixed(1) + "M";
            deltaEl.textContent = (delta >= 0 ? "+" : "") + dDisp;
            document.getElementById('long-valor').textContent = current.deltaLong;
            document.getElementById('short-valor').textContent = current.deltaShort;

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

        // Ejecutar Alertas y UI de la Estrategia pasando las Bandas de Bollinger
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

// Alerta de Cruce de MACD
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
    if (el) {
        el.style.boxShadow = `0 0 20px ${color}`;
        setTimeout(() => { el.style.boxShadow = "none"; }, 500);
    }
}

// --- MODIFICADO: ESTRATEGIA HOTERO INTEGRANDO BANDAS DE BOLLINGER COINCIDENTES ---
function updateStrategyUI(latest) {
    const signalEl = document.getElementById('main-signal');
    const adxTag = document.getElementById('strength-tag');
    
    const isStrong = latest.adx > 24;
    const histUp = latest.histogram > 0;
    const dmiBull = latest.dmiPlus > latest.dmiMinus;
    
    // Obtener precio actual y bandas calculadas por el servidor
    const price = currentPrice || latest.precio;
    const bbUpper = Number(latest.bbUpper);
    const bbLower = Number(latest.bbLower);

    // Filtros Bollinger: El precio debe estar en zona de la banda respectiva para validar el trigger
    // Damos una holgura del 0.15% para que detecte la cercanía antes del rebote exacto
    const precioEnBandaInferior = price <= (bbLower * 1.0015);
    const precioEnBandaSuperior = price >= (bbUpper * 0.9985);

    adxTag.textContent = `ADX: ${Number(latest.adx).toFixed(1)}`;
    adxTag.className = isStrong ? 'text-green' : '';

    // Condición combinada: Añadimos el filtro Bollinger como confirmación espacial de agotamiento/soporte
    if (isStrong && histUp && dmiBull && precioEnBandaInferior) {
        signalEl.textContent = "POSIBLE LONG";
        signalEl.style.background = "rgba(0, 255, 136, 0.2)";
        signalEl.style.color = "#00ff88";
    } else if (isStrong && !histUp && !dmiBull && precioEnBandaSuperior) {
        signalEl.textContent = "POSIBLE SHORT";
        signalEl.style.background = "rgba(255, 77, 77, 0.2)";
        signalEl.style.color = "#ff4d4d";
    } else {
        signalEl.textContent = "ESPERANDO...";
        signalEl.style.background = "#333";
        signalEl.style.color = "#fff";
    }
}

// --- GRÁFICOS (CHART.JS) OPTIMIZADO ---
// --- GRÁFICOS (CHART.JS) TOTALMENTE BLINDADOS CONTRA BLOQUEOS ---
function renderCharts(data, labels) {
    const opt = { 
        responsive: true, 
        maintainAspectRatio: false, 
        animation: false,
        plugins: { legend: { display: false } },
        scales: { 
            x: { display: false }, 
            y: { grid: { color: '#2a2e39' }, ticks: { color: '#888', font: { size: 8 } } } 
        }
    };

    // --- 1. GRÁFICO MACD ---
    const canvasM = document.getElementById('macdChart');
    if (canvasM) {
        const ctxM = canvasM.getContext('2d');
        const hD = data.map(d => Number(d.histogram));

        // Mapeo dinámico de colores del histograma
        const histogramColors = hD.map((v, idx) => {
            if (idx === 0) return v >= 0 ? '#35948E' : '#ff4d4d'; 
            const prevV = hD[idx - 1]; 
            if (v >= 0) {
                return v >= prevV ? '#35948E' : '#FA6969'; 
            } else {
                return v <= prevV ? '#ff4d4d' : '#26a69a'; 
            }
        });

        // SOLUCIÓN RADICAL: Si Chart.js ya tiene un gráfico registrado en este canvas, lo destruimos
        if (window.Chart && Chart.getChart(canvasM)) {
            Chart.getChart(canvasM).destroy();
        }

        // Creamos la instancia desde cero de manera limpia
        macdChart = new Chart(ctxM, {
            data: {
                labels,
                datasets: [
                    { type: 'bar', data: hD, backgroundColor: histogramColors }, 
                    { type: 'line', data: data.map(d => d.macdLine), borderColor: '#2196f3', borderWidth: 1.5, pointRadius: 0 },
                    { type: 'line', data: data.map(d => d.signalLine), borderColor: '#f0b90b', borderWidth: 1.5, pointRadius: 0 }
                ]
            },
            options: opt
        });
    }

    // --- 2. GRÁFICO ADX & DMI ---
    const canvasA = document.getElementById('adxChart');
    if (canvasA) {
        const ctxA = canvasA.getContext('2d');
        const adxDatasets = [
            { data: data.map(d => d.adx), borderColor: '#f0b90b', borderWidth: 2, pointRadius: 0 },
            { data: data.map(d => d.dmiPlus), borderColor: '#00ff88', borderWidth: 1.5, pointRadius: 0, fill: false },
            { data: data.map(d => d.dmiMinus), borderColor: '#ff4d4d', borderWidth: 1.5, pointRadius: 0, fill: false }
        ];

        // SOLUCIÓN RADICAL: Destruir gráfico previo en el canvas de ADX para evitar colisiones
        if (window.Chart && Chart.getChart(canvasA)) {
            Chart.getChart(canvasA).destroy();
        }

        adxChart = new Chart(ctxA, {
            type: 'line',
            data: { labels, datasets: adxDatasets },
            options: { ...opt, scales: { y: { min: 0, max: 60 } } }
        });
    }
}
// --- LOGICA PRECIO Y PNL ---
async function updateLivePrice() {
    try {
        const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
        const data = await response.json();
        currentPrice = parseFloat(data.price);

        document.getElementById('live-price').textContent = currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2 });

        if (entryData.type) {
            updatePicos(currentPrice);
            calculatePnL();
        }
    } catch (e) { console.error("Error Binance:", e); }
}

function updatePicos(price) {
    let updated = false;
    if (entryData.max === 0) { entryData.max = price; updated = true; }
    if (entryData.min === 0) { entryData.min = price; updated = true; }

    if (price > entryData.max) { entryData.max = price; updated = true; }
    if (price < entryData.min) { entryData.min = price; updated = true; }

    if (updated) {
        localStorage.setItem('active_trade', JSON.stringify(entryData));
        renderPicosUI();
    }
}

function calculatePnL() {
    if (!entryData.price) return;
    let pnlBase = ((entryData.type === 'LONG' ? (currentPrice - entryData.price) : (entryData.price - currentPrice)) / entryData.price);
    let pnlPercent = pnlBase * 100 * 20; 

    const pnlEl = document.getElementById('pnl-val');
    pnlEl.textContent = (pnlPercent >= 0 ? "+" : "") + pnlPercent.toFixed(2) + "%";
    pnlEl.style.color = pnlPercent >= 0 ? "#00ff88" : "#ff4d4d";
}

function renderPicosUI() {
    if (!entryData.max || !entryData.min || !entryData.price) return;
    const calcVar = (pico) => {
        let v = ((entryData.type === 'LONG' ? (pico - entryData.price) : (entryData.price - pico)) / entryData.price) * 100 * 20;
        return v.toFixed(2);
    };
    document.getElementById('max-val').textContent = `${entryData.max.toFixed(2)} (${calcVar(entryData.max)}%)`;
    document.getElementById('min-val').textContent = `${entryData.min.toFixed(2)} (${calcVar(entryData.min)}%)`;
}

function saveTrade(type) {
    entryData = { price: currentPrice, type: type, max: currentPrice, min: currentPrice };
    localStorage.setItem('active_trade', JSON.stringify(entryData));
    showTradeUI();
    renderPicosUI();
}

document.getElementById('btn-long').onclick = () => saveTrade('LONG');
document.getElementById('btn-short').onclick = () => saveTrade('SHORT');
document.getElementById('btn-clear').onclick = () => {
    localStorage.removeItem('active_trade');
    entryData = { price: 0, type: null, max: 0, min: 0 }; 
    document.getElementById('pnl-display').style.display = 'none';
};

function showTradeUI() {
    document.getElementById('pnl-display').style.display = 'block';
    const info = document.getElementById('entry-info');
    info.textContent = `${entryData.type} @ ${entryData.price.toFixed(2)}`;
    info.style.color = entryData.type === 'LONG' ? '#00ff88' : '#ff4d4d';
    renderPicosUI();
}

const savedTrade = localStorage.getItem('active_trade');
if (savedTrade) {
    entryData = JSON.parse(savedTrade);
    showTradeUI(); 
} else {
    entryData = { price: 0, type: null, max: 0, min: 0 };
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

// --- DELTA ---
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
