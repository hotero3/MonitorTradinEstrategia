const BASE_WEB_APP_URL = "https://dashboardhtrading.onrender.com/get-indicators";
let currentTimeframe = "15m"; // Temporalidad por defecto

let macdChart = null, adxChart = null;
let isMuted = false, alertThreshold = 100, lastAlertTime = 0;
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let lastDelta = null;
let lastHistSign = null;
let currentPrice = 0;
let entryData = JSON.parse(localStorage.getItem('active_trade')) || { price: 0, type: null, max: 0, min: 0 };

// --- DETECTAR CAMBIO DE TEMPORALIDAD ---
const tfSelector = document.getElementById('tf-select');
if (tfSelector) {
    tfSelector.onchange = (e) => {
        currentTimeframe = e.target.value;
        updateDashboard();
    };
}

function initAlertControls() {
    const thInput = document.getElementById('alert_th');
    const muteBtn = document.getElementById('mute_btn');
    const savedTh = localStorage.getItem('h_th');
    const savedMute = localStorage.getItem('h_mute');

    if (savedTh) { alertThreshold = parseFloat(savedTh); thInput.value = savedTh; }
    if (savedMute !== null) {
        isMuted = savedMute === 'true';
        muteBtn.textContent = isMuted ? '🔇' : '🔊';
        muteBtn.style.color = isMuted ? '#ff4d4d' : '#00ff88';
    }
    thInput.oninput = (e) => { alertThreshold = parseFloat(e.target.value) || 0; localStorage.setItem('h_th', e.target.value); };
    muteBtn.onclick = () => {
        isMuted = !isMuted; localStorage.setItem('h_mute', isMuted);
        muteBtn.textContent = isMuted ? '🔇' : '🔊';
        muteBtn.style.color = isMuted ? '#ff4d4d' : '#00ff88';
    };
}
initAlertControls();

async function updateDashboard() {
    const statusDot = document.getElementById('status');
    try {
        const response = await fetch(`${BASE_WEB_APP_URL}?interval=${currentTimeframe}`);
        const allData = await response.json(); 
        if (!allData || allData.length < 2) return;

        const current = allData[0];
        const previous = allData[1];

        // Guardar bandas calculadas del servidor globales de manera segura
        window.localBbUpper = current.bbUpper;
        window.localBbLower = current.bbLower;

        // --- PROCESAMIENTO RSI CON MEJORA VISUAL DE FLECHAS EN VIVO ---
        if (current.rsi !== undefined) {
            const rsiVal = Number(current.rsi);
            const rsiPrevVal = Number(previous.rsi);
            const rsiElement = document.getElementById('rsi-val');
            const rsiTextElement = document.getElementById('rsi-text');

            if (rsiElement && rsiTextElement) {
                let flecha = "";
                let colorFlecha = "";
                if (rsiVal > rsiPrevVal) {
                    flecha = " ▲";
                    colorFlecha = "#00ff88"; 
                } else if (rsiVal < rsiPrevVal) {
                    flecha = " ▼";
                    colorFlecha = "#ff4d4d"; 
                }

                rsiElement.textContent = rsiVal.toFixed(2);

                if (rsiVal >= 70) { rsiTextElement.innerHTML = `Sobre compra <span style="color:${colorFlecha}">${flecha}</span>`; rsiTextElement.style.color = "#35948E"; rsiElement.style.color = "#35948E"; }
                else if (rsiVal >= 55) { rsiTextElement.innerHTML = `Compra fuerte <span style="color:${colorFlecha}">${flecha}</span>`; rsiTextElement.style.color = "#26a69a"; rsiElement.style.color = "#26a69a"; }
                else if (rsiVal > 45 && rsiVal < 55) { rsiTextElement.innerHTML = `Neutral <span style="color:${colorFlecha}">${flecha}</span>`; rsiTextElement.style.color = "#f0b90b"; rsiElement.style.color = "#f0b90b"; }
                else if (rsiVal <= 30) { rsiTextElement.innerHTML = `Sobre venta <span style="color:${colorFlecha}">${flecha}</span>`; rsiTextElement.style.color = "#ff4d4d"; rsiElement.style.color = "#ff4d4d"; }
                else if (rsiVal <= 45) { rsiTextElement.innerHTML = `Venta fuerte <span style="color:${colorFlecha}">${flecha}</span>`; rsiTextElement.style.color = "#ff9800"; rsiElement.style.color = "#ff9800"; }
            }
        }    

        // --- PROCESAMIENTO DELTA ---
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
                if (!isMuted && (Date.now() - lastAlertTime > 15000)) { sonarNotificacion(delta >= 0 ? 'LONG' : 'SHORT'); lastAlertTime = Date.now(); }
            } else {
                container.style.background = "#1e222d"; container.style.border = "none";
                container.style.borderLeft = "4px solid #f0b90b"; deltaEl.style.color = delta >= 0 ? "#00ff88" : "#ff4d4d";
            }
        }

        checkMACDAlerts(current, previous);
        updateStrategyUI(current, allData);

        const adxValsEl = document.getElementById('adx_vals');
        if (adxValsEl) adxValsEl.textContent = `${Number(current.adx).toFixed(1)} | ${Number(current.dmiPlus).toFixed(1)} | ${Number(current.dmiMinus).toFixed(1)}`;

        const macdFullValsEl = document.getElementById('macd_full_vals');
        if (macdFullValsEl) macdFullValsEl.textContent = `${Number(current.histogram).toFixed(2)} | ${Number(current.macdLine).toFixed(2)} | ${Number(current.signalLine).toFixed(2)}`;

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

function checkMACDAlerts(curr, prev) {
    const signalEl = document.getElementById('main-signal');
    const currentSign = Math.sign(curr.histogram);
    const prevSign = Math.sign(prev.histogram);

    if (lastHistSign !== null && currentSign !== prevSign) {
        const esLong = currentSign > 0;
        triggerFlash('main-signal', esLong ? "#00ff88" : "#ff4d4d");
        const deltaEl = document.getElementById('delta_val');
        const deltaVal = deltaEl ? parseFloat(deltaEl.textContent) || 0 : 0;
        if (curr.adx > 18 || Math.abs(deltaVal) > alertThreshold) { sonarNotificacion(esLong ? 'LONG' : 'SHORT'); }
    }
    lastHistSign = currentSign;

    if (signalEl) {
        const gap = Math.abs(curr.macdLine - curr.signalLine);
        if (gap < 0.12) { signalEl.style.border = "2px solid #f0b90b"; signalEl.classList.add('blink-border'); } 
        else { signalEl.style.border = "none"; signalEl.classList.remove('blink-border'); }
    }
}

function triggerFlash(elId, color) {
    const el = document.getElementById(elId);
    if (el) { el.style.boxShadow = `0 0 20px ${color}`; setTimeout(() => { el.style.boxShadow = "none"; }, 500); }
}

// --- ESTRATEGIA INTEGRADA DE MANERA SEGURA CON LAS BANDAS DEL SERVIDOR ---
function updateStrategyUI(latest, allData) {
    const signalEl = document.getElementById('main-signal');
    const adxTag = document.getElementById('strength-tag');
    const alertRevEl = document.getElementById('alert-reversion'); 
    
    if (!signalEl || !adxTag || !allData || allData.length < 2) return;
    
    const previous = allData[1];
    const isStrong = latest.adx > 22;
    const adxAcelerando = latest.adx > previous.adx; 
    
    const histUp = latest.histogram > 0;
    const dmiBull = latest.dmiPlus > latest.dmiMinus;
    
    let precioPorDebajoBandaLower = false;
    let precioPorEncimaBandaUpper = false;
    let advertenciaReversion = "";
    let colorAdvertencia = "";

    // Evaluar usando las bandas estables inyectadas por el servidor de Python
    if (window.localBbUpper && window.localBbLower && currentPrice > 0) {
        precioPorDebajoBandaLower = currentPrice <= window.localBbLower;
        precioPorEncimaBandaUpper = currentPrice >= window.localBbUpper;

        if (precioPorDebajoBandaLower && !histUp) {
            advertenciaReversion = "⚠️ ALERTA: Precio bajo la Banda Inferior. Posible REVERSIÓN AL ALZA (Agotamiento Short).";
            colorAdvertencia = "#f0b90b"; 
        } else if (precioPorEncimaBandaUpper && histUp) {
            advertenciaReversion = "⚠️ ALERTA: Precio sobre la Banda Superior. Posible REVERSIÓN A LA BAJA (Agotamiento Long).";
            colorAdvertencia = "#f0b90b";
        } else if (precioPorDebajoBandaLower && histUp && dmiBull && isStrong) {
            advertenciaReversion = "🔥 CONFLUENCIA PERFECTA: Ruptura alcista desde soporte extremo de Bollinger.";
            colorAdvertencia = "#00ff88"; 
        } else if (precioPorEncimaBandaUpper && !histUp && !dmiBull && isStrong) {
            advertenciaReversion = "💥 CONFLUENCIA PERFECTA: Ruptura bajista desde resistencia extrema de Bollinger.";
            colorAdvertencia = "#ff4d4d"; 
        }
    }

    if (alertRevEl) {
        if (advertenciaReversion !== "") {
            alertRevEl.textContent = advertenciaReversion;
            alertRevEl.style.border = `1px solid ${colorAdvertencia}`;
            alertRevEl.style.color = colorAdvertencia;
            alertRevEl.style.display = "block";
        } else {
            alertRevEl.style.display = "none"; 
        }
    }

    adxTag.textContent = `ADX: ${Number(latest.adx).toFixed(1)} (${adxAcelerando ? '▲' : '▼'})`;
    adxTag.className = isStrong ? 'text-green' : '';

    // SEÑAL MAESTRA DE ENTRADA CON EL FILTRO ANTITRAMPAS
    if (isStrong && adxAcelerando && histUp && dmiBull) {
        if (precioPorEncimaBandaUpper) {
            signalEl.textContent = "ESPERAR RECORTE (Riesgo de Rechazo)";
            signalEl.style.background = "rgba(240, 185, 11, 0.1)";
            signalEl.style.color = "#f0b90b";
        } else {
            signalEl.textContent = "POSIBLE LONG";
            signalEl.style.background = "rgba(0, 255, 136, 0.2)";
            signalEl.style.color = "#00ff88";
        }
    } 
    else if (isStrong && adxAcelerando && !histUp && !dmiBull) {
        if (precioPorDebajoBandaLower) {
            signalEl.textContent = "ESPERAR REBOTE (Soporte Mayor)";
            signalEl.style.background = "rgba(240, 185, 11, 0.1)";
            signalEl.style.color = "#f0b90b";
        } else {
            signalEl.textContent = "POSIBLE SHORT";
            signalEl.style.background = "rgba(255, 77, 77, 0.2)";
            signalEl.style.color = "#ff4d4d";
        }
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

    const canvasM = document.getElementById('macdChart');
    if (canvasM) {
        const ctxM = canvasM.getContext('2d');
        const hD = data.map(d => Number(d.histogram));
        const histogramColors = hD.map((v, idx) => {
            if (idx === 0) return v >= 0 ? '#35948E' : '#ff4d4d'; 
            const prevV = hD[idx - 1]; 
            return v >= 0 ? (v >= prevV ? '#35948E' : '#FA6969') : (v <= prevV ? '#ff4d4d' : '#26a69a');
        });

        if (window.Chart && Chart.getChart(canvasM)) { Chart.getChart(canvasM).destroy(); }

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

    const canvasA = document.getElementById('adxChart');
    if (canvasA) {
        const ctxA = canvasA.getContext('2d');
        const adxDatasets = [
            { data: data.map(d => d.adx), borderColor: '#f0b90b', borderWidth: 2, pointRadius: 0 },
            { data: data.map(d => d.dmiPlus), borderColor: '#00ff88', borderWidth: 1.5, pointRadius: 0, fill: false },
            { data: data.map(d => d.dmiMinus), borderColor: '#ff4d4d', borderWidth: 1.5, pointRadius: 0, fill: false }
        ];

        if (window.Chart && Chart.getChart(canvasA)) { Chart.getChart(canvasA).destroy(); }

        adxChart = new Chart(ctxA, {
            type: 'line',
            data: { labels, datasets: adxDatasets },
            options: { ...opt, scales: { y: { min: 0, max: 60 } } }
        });
    }
}

async function updateLivePrice() {
    try {
        const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
        const data = await response.json();
        currentPrice = parseFloat(data.price);

        const livePriceEl = document.getElementById('live-price');
        if (livePriceEl) livePriceEl.textContent = currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2 });

        if (entryData.type) { updatePicos(currentPrice); calculatePnL(); }
    } catch (e) { console.error("Error Binance:", e); }
}

function updatePicos(price) {
    let updated = false;
    if (entryData.max === 0) { entryData.max = price; updated = true; }
    if (entryData.min === 0) { entryData.min = price; updated = true; }
    if (price > entryData.max) { entryData.max = price; updated = true; }
    if (price < entryData.min) { entryData.min = price; updated = true; }

    if (updated) { localStorage.setItem('active_trade', JSON.stringify(entryData)); renderPicosUI(); }
}

function calculatePnL() {
    if (!entryData.price) return;
    let pnlBase = ((entryData.type === 'LONG' ? (currentPrice - entryData.price) : (entryData.price - currentPrice)) / entryData.price);
    let pnlPercent = pnlBase * 100 * 20; 

    const pnlEl = document.getElementById('pnl-val');
    if (pnlEl) { pnlEl.textContent = (pnlPercent >= 0 ? "+" : "") + pnlPercent.toFixed(2) + "%"; pnlEl.style.color = pnlPercent >= 0 ? "#00ff88" : "#ff4d4d"; }
}

function renderPicosUI() {
    if (!entryData.max || !entryData.min || !entryData.price) return;
    const calcVar = (pico) => (((entryData.type === 'LONG' ? (pico - entryData.price) : (entryData.price - pico)) / entryData.price) * 100 * 20).toFixed(2);
    
    const maxValEl = document.getElementById('max-val'); if (maxValEl) maxValEl.textContent = `${entryData.max.toFixed(2)} (${calcVar(entryData.max)}%)`;
    const minValEl = document.getElementById('min-val'); if (minValEl) minValEl.textContent = `${entryData.min.toFixed(2)} (${calcVar(entryData.min)}%)`;
}

function saveTrade(type) {
    entryData = { price: currentPrice, type: type, max: currentPrice, min: currentPrice };
    localStorage.setItem('active_trade', JSON.stringify(entryData));
    showTradeUI(); renderPicosUI();
}

const btnLong = document.getElementById('btn-long'); if (btnLong) btnLong.onclick = () => saveTrade('LONG');
const btnShort = document.getElementById('btn-short'); if (btnShort) btnShort.onclick = () => saveTrade('SHORT');
const btnClear = document.getElementById('btn-clear');
if (btnClear) {
    btnClear.onclick = () => {
        localStorage.removeItem('active_trade');
        entryData = { price: 0, type: null, max: 0, min: 0 }; 
        const pnlDisplayEl = document.getElementById('pnl-display'); if (pnlDisplayEl) pnlDisplayEl.style.display = 'none';
    };
}

function showTradeUI() {
    const pnlDisplayEl = document.getElementById('pnl-display'); if (pnlDisplayEl) pnlDisplayEl.style.display = 'block';
    const info = document.getElementById('entry-info');
    if (info) { info.textContent = `${entryData.type} @ ${entryData.price.toFixed(2)}`; info.style.color = entryData.type === 'LONG' ? '#00ff88' : '#ff4d4d'; }
    renderPicosUI();
}

const savedTrade = localStorage.getItem('active_trade');
if (savedTrade) { entryData = JSON.parse(savedTrade); showTradeUI(); } 
else { entryData = { price: 0, type: null, max: 0, min: 0 }; }

function sonarNotificacion(tipo) {
    if (isMuted) return;
    try {
        const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination); const ahora = audioCtx.currentTime;
        if (tipo === 'LONG') { osc.frequency.setValueAtTime(440, ahora); osc.frequency.exponentialRampToValueAtTime(880, ahora + 0.2); } 
        else { osc.frequency.setValueAtTime(880, ahora); osc.frequency.exponentialRampToValueAtTime(440, ahora + 0.2); }
        osc.start(); gain.gain.exponentialRampToValueAtTime(0.0001, ahora + 0.5); osc.stop(ahora + 0.5);
    } catch(e) {}
}

function updateDeltaDisplay() {
    const savedDelta = localStorage.getItem('btcDeltaData');
    if (savedDelta) {
        const data = JSON.parse(savedDelta); const lVal = parseCoinGlassValue(data.lStr); const sVal = parseCoinGlassValue(data.sStr); const delta = lVal - sVal;
        const deltaValEl = document.getElementById('delta_val'); if (deltaValEl) deltaValEl.textContent = (delta >= 0 ? "+" : "") + (delta/1000).toFixed(2) + "B";
        const longValEl = document.getElementById('long-valor'); if (longValEl) longValEl.textContent = data.lStr;
        const shortValEl = document.getElementById('short-valor'); if (shortValEl) shortValEl.textContent = data.sStr;
    }
}

function parseCoinGlassValue(str) { if(!str) return 0; const num = parseFloat(str.replace(/[^0-9.]/g, '')); return str.includes('B') ? num * 1000 : num; }

setInterval(updateDashboard, 1500);
setInterval(updateLivePrice, 2000);
setInterval(updateDeltaDisplay, 5000);
updateLivePrice();
updateDashboard();
