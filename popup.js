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

// --- DETECTAR CAMBIO DE TEMPORALIDAD ---\nconst tfSelector = document.getElementById('tf-select');
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
    if (savedMute) { isMuted = (savedMute === 'true'); if (muteBtn) muteBtn.textContent = isMuted ? "🔇 MUTED" : "🔊 SOUND"; }

    if (thInput) {
        thInput.oninput = (e) => {
            alertThreshold = parseFloat(e.target.value) || 0;
            localStorage.setItem('h_th', alertThreshold);
            updateDeltaDisplay();
        };
    }
    if (muteBtn) {
        muteBtn.onclick = () => {
            isMuted = !isMuted;
            localStorage.setItem('h_mute', isMuted);
            muteBtn.textContent = isMuted ? "🔇 MUTED" : "🔊 SOUND";
        };
    }
}

async function updateDashboard() {
    try {
        const res = await fetch(`${BASE_WEB_APP_URL}?interval=${currentTimeframe}`);
        if (!res.ok) throw new Error("Error en HTTP");
        const data = await res.json();
        if (!data || data.length === 0) return;

        // Como el array viene de Pasado -> Presente, el último elemento es el actual en vivo:
        const latest = data[data.length - 1];
        currentPrice = latest.precio;

        // Actualizar UI básica
        document.getElementById('rsi-text').textContent = latest.rsi;
        document.getElementById('status').style.color = "#00ff88";

        // Guardar Delta en LocalStorage para sincronía
        if (latest.deltaLong && latest.deltaShort) {
            localStorage.setItem('btcDeltaData', JSON.stringify({ lStr: latest.deltaLong, sStr: latest.deltaShort }));
            updateDeltaDisplay();
        }

        // Ejecutar lógica de estrategia pasando el array cronológico correcto
        updateStrategyUI(latest, data);
        
        // Renderizar Gráficos de forma limpia de izquierda a derecha
        renderCharts(data);
        
        // Seguimiento de Trade Activo si existe
        updateActiveTradeLogic();

    } catch (e) {
        console.error("Error actualizando dashboard:", e);
        document.getElementById('status').style.color = "#ff4d4d";
    }
}

function updateStrategyUI(latest, allData) {
    const signalEl = document.getElementById('main-signal');
    const adxTag = document.getElementById('strength-tag');
    const alertRevEl = document.getElementById('alert-reversion'); 
    
    if (!signalEl || !adxTag || !allData || allData.length < 2) return;
    
    // Vela anterior es la penúltima
    const previous = allData[allData.length - 2];
    const isStrong = latest.adx > 22;
    const adxAcelerando = latest.adx > previous.adx; 
    const histUp = latest.histogram > 0;
    const dmiBull = latest.dmiPlus > latest.dmiMinus;
    
    const upperBand = latest.bbUpper;
    const lowerBand = latest.bbLower;
    const precioActual = latest.precio; 

    let precioPorDebajoBandaLower = precioActual <= lowerBand;
    let precioPorEncimaBandaUpper = precioActual >= upperBand;
    let advertenciaReversion = "";
    let colorAdvertencia = "";

    if (upperBand && lowerBand) {
        if (precioPorDebajoBandaLower && !histUp) {
            advertenciaReversion = "⚠️ ALERTA: Precio bajo Banda Inferior Real. Agotamiento Short.";
            colorAdvertencia = "#f0b90b";
        } else if (precioPorEncimaBandaUpper && histUp) {
            advertenciaReversion = "⚠️ ALERTA: Precio sobre Banda Superior Real. Agotamiento Long.";
            colorAdvertencia = "#f0b90b";
        } else if (precioPorDebajoBandaLower && histUp && dmiBull && isStrong) {
            advertenciaReversion = "🔥 CONFLUENCIA PERFECTA: Reversión Alcista desde Soporte Real.";
            colorAdvertencia = "#00ff88";
        } else if (precioPorEncimaBandaUpper && !histUp && !dmiBull && isStrong) {
            advertenciaReversion = "💥 CONFLUENCIA PERFECTA: Reversión Bajista desde Resistencia Real.";
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

    // Gestión de Alertas Sonoras Locales basadas en cruces de Histograma MACD
    let currentHistSign = latest.histogram >= 0 ? 'UP' : 'DOWN';
    if (lastHistSign !== null && lastHistSign !== currentHistSign) {
        const ahoraMilis = Date.now();
        if (ahoraMilis - lastAlertTime > 60000) { // Cooldown de 1 minuto
            if (currentHistSign === 'UP' && isStrong && dmiBull && !precioPorEncimaBandaUpper) {
                PlayAlertSound('LONG');
                lastAlertTime = ahoraMilis;
            } else if (currentHistSign === 'DOWN' && isStrong && !dmiBull && !precioPorDebajoBandaLower) {
                PlayAlertSound('SHORT');
                lastAlertTime = ahoraMilis;
            }
        }
    }
    lastHistSign = currentHistSign;

    // Cambios visuales del Bloque de Señal Principal
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

function updateActiveTradeLogic() {
    if (!entryData || !entryData.price) return;
    const pnlEl = document.getElementById('pnl-value');
    const pnlPctEl = document.getElementById('pnl-pct');
    if (!pnlEl || !pnlPctEl) return;

    let diff = 0;
    if (entryData.type === 'LONG') {
        diff = currentPrice - entryData.price;
        if (currentPrice > entryData.max) entryData.max = currentPrice;
    } else {
        diff = entryData.price - currentPrice;
        if (currentPrice < entryData.min || entryData.min === 0) entryData.min = currentPrice;
    }
    localStorage.setItem('active_trade', JSON.stringify(entryData));

    const pct = (diff / entryData.price) * 100;
    pnlEl.textContent = (diff >= 0 ? "+" : "") + diff.toFixed(2);
    pnlPctEl.textContent = (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%";
    
    pnlEl.style.color = diff >= 0 ? "#00ff88" : "#ff4d4d";
    pnlPctEl.style.color = diff >= 0 ? "#00ff88" : "#ff4d4d";
}

function renderCharts(histData) {
    const labels = histData.map(d => {
        const date = new Date(d.tiempo);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    });

    // 1. Renderizar Gráfico MACD
    const ctxMacd = document.getElementById('macdChart').getContext('2d');
    const histValues = histData.map(d => d.histogram);
    const bgColors = histValues.map(v => v >= 0 ? 'rgba(0, 255, 136, 0.6)' : 'rgba(255, 77, 77, 0.6)');

    if (macdChart) macdChart.destroy();
    macdChart = new Chart(ctxMacd, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{ data: histValues, backgroundColor: bgColors, borderWidth: 0 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { display: false }, y: { grid: { color: '#2a2e39' }, ticks: { color: '#787b86', font: { size: 8 } } } }
        }
    });

    // 2. Renderizar Gráfico ADX & DMI
    const ctxAdx = document.getElementById('adxChart').getContext('2d');
    if (adxChart) adxChart.destroy();
    adxChart = new Chart(ctxAdx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: 'ADX', data: histData.map(d => d.adx), borderColor: '#f0b90b', borderWidth: 2, pointRadius: 0, fill: false },
                { label: 'DI+', data: histData.map(d => d.dmiPlus), borderColor: '#00ff88', borderWidth: 1, pointRadius: 0, fill: false },
                { label: 'DI-', data: histData.map(d => d.dmiMinus), borderColor: '#ff4d4d', borderWidth: 1, pointRadius: 0, fill: false }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { display: false }, y: { grid: { color: '#2a2e39' }, ticks: { color: '#787b86', font: { size: 8 } } } }
        }
    });
}

function parseCoinGlassValue(str) {
    if (!str || str === '--') return 0;
    let clean = str.replace(/[$,\s]/g, '');
    let multiplier = 1;
    if (clean.toUpperCase().includes('M')) { multiplier = 1000000; clean = clean.replace(/M/i, ''); }
    else if (clean.toUpperCase().includes('K')) { multiplier = 1000; clean = clean.replace(/K/i, ''); }
    return parseFloat(clean) * multiplier;
}

function updateDeltaDisplay() {
    const savedDelta = localStorage.getItem('btcDeltaData');
    if (savedDelta) {
        const data = JSON.parse(savedDelta); 
        const lVal = parseCoinGlassValue(data.lStr); 
        const sVal = parseCoinGlassValue(data.sStr); 
        const delta = lVal - sVal;
        
        const deltaValEl = document.getElementById('delta_val'); 
        if (deltaValEl) deltaValEl.textContent = (delta >= 0 ? "+" : "") + (delta/1000000000).toFixed(2) + "B";
        
        const longValEl = document.getElementById('long-valor'); if (longValEl) longValEl.textContent = data.lStr;
        const shortValEl = document.getElementById('short-valor'); if (shortValEl) shortValEl.textContent = data.sStr;
    }
}

function PlayAlertSound(tipo) {
    if (isMuted) return;
    try {
        const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination); const ahora = audioCtx.currentTime;
        if (tipo === 'LONG') { osc.frequency.setValueAtTime(440, ahora); osc.frequency.exponentialRampToValueAtTime(880, ahora + 0.2); } 
        else { osc.frequency.setValueAtTime(880, ahora); osc.frequency.exponentialRampToValueAtTime(440, ahora + 0.2); }
        osc.start(); gain.gain.exponentialRampToValueAtTime(0.0001, ahora + 0.5); osc.stop(ahora + 0.5);
    } catch(e) {}
}

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    initAlertControls();
    updateDashboard();
    setInterval(updateDashboard, 15000); // Actualiza cada 15 segundos
});
