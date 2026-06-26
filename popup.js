const BASE_WEB_APP_URL = "https://dashboardhtrading.onrender.com/get-indicators";
let currentTimeframe = "15m"; // Temporalidad por defecto

let macdChart = null, adxChart = null;
let isMuted = false, alertThreshold = 100, lastAlertTime = 0;
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let lastDelta = null;
let lastHistSign = null;
let currentPrice = 0;
let entryData = JSON.parse(localStorage.getItem('active_trade')) || { price: 0, type: null, max: 0, min: 0 };
let priceHistory = []; 

// --- DETECTAR CAMBIO DE TEMPORALIDAD ---
const tfSelector = document.getElementById('tf-select');
if (tfSelector) {
    tfSelector.onchange = (e) => {
        currentTimeframe = e.target.value;
        updateDashboard();
    };
}

function initAlertControls() {
    try {
        const thInput = document.getElementById('alert_th');
        const muteBtn = document.getElementById('mute_btn');
        const savedTh = localStorage.getItem('h_th');
        const savedMute = localStorage.getItem('h_mute');

        if (savedTh && thInput) { alertThreshold = parseFloat(savedTh); thInput.value = savedTh; }
        if (savedMute !== null && muteBtn) {
            isMuted = savedMute === 'true';
            muteBtn.textContent = isMuted ? '🔇' : '🔊';
            muteBtn.style.color = isMuted ? '#ff4d4d' : '#00ff88';
        }
        if (thInput) {
            thInput.oninput = (e) => { alertThreshold = parseFloat(e.target.value) || 0; localStorage.setItem('h_th', e.target.value); };
        }
        if (muteBtn) {
            muteBtn.onclick = () => {
                isMuted = !isMuted; localStorage.setItem('h_mute', isMuted);
                muteBtn.textContent = isMuted ? '🔇' : '🔊';
                muteBtn.style.color = isMuted ? '#ff4d4d' : '#00ff88';
            };
        }
    } catch (e) { console.warn("Aviso en Controles Alertas (HTML incompleto):", e); }
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

        // Guardar bandas globales inyectadas de forma segura
        window.localBbUpper = current.bbUpper || 0;
        window.localBbLower = current.bbLower || 0;

        // 1. SECCIÓN RSI
        try {
            if (current.rsi !== undefined) {
                const rsiVal = Number(current.rsi);
                const rsiPrevVal = Number(previous.rsi);
                const rsiElement = document.getElementById('rsi-val');
                const rsiTextElement = document.getElementById('rsi-text');

                if (rsiElement && rsiTextElement) {
                    let flecha = "";
                    let colorFlecha = "";
                    if (rsiVal > rsiPrevVal) { flecha = " ▲"; colorFlecha = "#00ff88"; } 
                    else if (rsiVal < rsiPrevVal) { flecha = " ▼"; colorFlecha = "#ff4d4d"; }

                    rsiElement.textContent = rsiVal.toFixed(2);

                    if (rsiVal >= 70) { rsiTextElement.innerHTML = `Sobre compra <span style="color:${colorFlecha}">${flecha}</span>`; rsiTextElement.style.color = "#35948E"; rsiElement.style.color = "#35948E"; }
                    else if (rsiVal >= 55) { rsiTextElement.innerHTML = `Compra fuerte <span style="color:${colorFlecha}">${flecha}</span>`; rsiTextElement.style.color = "#26a69a"; rsiElement.style.color = "#26a69a"; }
                    else if (rsiVal > 45 && rsiVal < 55) { rsiTextElement.innerHTML = `Neutral <span style="color:${colorFlecha}">${flecha}</span>`; rsiTextElement.style.color = "#f0b90b"; rsiElement.style.color = "#f0b90b"; }
                    else if (rsiVal <= 30) { rsiTextElement.innerHTML = `Sobre venta <span style="color:${colorFlecha}">${flecha}</span>`; rsiTextElement.style.color = "#ff4d4d"; rsiElement.style.color = "#ff4d4d"; }
                    else if (rsiVal <= 45) { rsiTextElement.innerHTML = `Venta fuerte <span style="color:${colorFlecha}">${flecha}</span>`; rsiTextElement.style.color = "#ff9800"; rsiElement.style.color = "#ff9800"; }
                }
            }
        } catch(err) { console.error("Error en renderizado RSI:", err); }

        // 2. SECCIÓN DELTA NATIVO (FETCH DESDE SERVIDOR)
        try {
            if (current.deltaLong && current.deltaLong !== "--") {
                const deltaEl = document.getElementById('delta_val');
                const container = document.getElementById('delta-container'); 

                const lVal = parseCoinGlassValue(current.deltaLong);
                const sVal = parseCoinGlassValue(current.deltaShort);
                const delta = lVal - sVal;

                let dDisp = Math.abs(delta) >= 1000 ? (delta/1000).toFixed(2) + "B" : delta.toFixed(1) + "M";
                if (deltaEl) deltaEl.textContent = (delta >= 0 ? "+" : "") + dDisp;
                
                const lVolEl = document.getElementById('long-valor'); if (lVolEl) lVolEl.textContent = current.deltaLong;
                const sVolEl = document.getElementById('short-valor'); if (sVolEl) sVolEl.textContent = current.deltaShort;

                if (container && deltaEl) {
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
            }
        } catch(err) { console.error("Error en renderizado Delta Servidor:", err); }

        // 3. ALERTAS MACD Y ESTRATEGIA
        checkMACDAlerts(current, previous);
        updateStrategyUI(current, allData);

        // 4. TEXTOS EN SUB-CONTENEDORES
        const adxValsEl = document.getElementById('adx_vals');
        if (adxValsEl) adxValsEl.textContent = `${Number(current.adx).toFixed(1)} | ${Number(current.dmiPlus).toFixed(1)} | ${Number(current.dmiMinus).toFixed(1)}`;

        const macdFullVals
