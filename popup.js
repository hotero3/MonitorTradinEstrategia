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

    if (!thInput || !muteBtn) return; 

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

// --- CODIGO PARA MINIMO Y MAXIMO ----
function startTradeTracking(type, currentPrice) {
    isTradeActive = true;
    tradeType = type;
    entryPrice = currentPrice;
    maxReached = currentPrice;
    minReached = currentPrice;
    console.log(`Trade ${type} iniciado en ${entryPrice}`);
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

        // --- PROCESAMIENTO DEL RSI ---
        if (current.rsi !== undefined) {
            const rsiVal = Number(current.rsi);
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

        // --- PROCESAMIENTO DEL DELTA COINGLASS CON FILTRO BOLLINGER ---
        if (current.deltaLong && current.deltaLong !== "--") {
            const deltaEl = document.getElementById('delta_val');
            const container = document.getElementById('delta-container'); 
            
            if (deltaEl && container) {
                const lVal = parseCoinGlassValue(current.deltaLong);
                const sVal = parseCoinGlassValue(current.deltaShort);
                const delta = lVal - sVal;
                    
                let dDisp = Math.abs(delta) >= 1000 ? (delta/1000).toFixed(2) + "B" : delta.toFixed(1) + "M";
                deltaEl.textContent = (delta >= 0 ? "+" : "") + dDisp;
                
                const lEl = document.getElementById('long-valor');
                const sEl = document.getElementById('short-valor');
                if (lEl) lEl.textContent = current.deltaLong;
                if (sEl) sEl.textContent = current.deltaShort;

                // LÓGICA DE ALERTA AL DETECTAR EXPANSIÓN DE VOLUMEN
                if (Math.abs(delta) >= alertThreshold && alertThreshold > 0) {
                    container.style.background = delta >= 0 ? "#003d21" : "#3d0000"; 
                    container.style.border = "2px solid #fff"; 
                    deltaEl.style.color = "#fff"; 

                    if (!isMuted && (Date.now() - lastAlertTime > 15000)) {
                        // FILTRO INVISIBLE DE BOLLINGER PARA DELTA
                        if (delta >= 0 && current.bbPermiteLong) {
                            sonarNotificacion('LONG');
                            lastAlertTime = Date.now();
                        } else if (delta < 0 && current.bbPermiteShort) {
                            sonarNotificacion('SHORT');
                            lastAlertTime = Date.now();
                        } else {
                            console.log("Alerta Delta silenciada por filtro de Bandas de Bollinger.");
                        }
                    }
                } else {
                    container.style.background = "#1e222d"; 
                    container.style.border = "none";
                    container.style.borderLeft = "4px solid #f0b90b"; 
                    deltaEl.style.color = delta >= 0 ? "#00ff88" : "#ff4d4d";
                }
            }
        }

        // Ejecución de alertas de indicadores principales
        checkMACDAlerts(current, previous);
        updateStrategyUI(current);

        const adxValsEl = document.getElementById('adx_vals');
        if (adxValsEl) {
            adxValsEl.textContent = `${Number(current.adx).toFixed(1)} | ${Number(current.dmiPlus).toFixed(1)} | ${Number(current.dmiMinus).toFixed(1)}`;
        }
        
        const macdValsEl = document.getElementById('macd_full_vals');
        if (macdValsEl) {
            macdValsEl.textContent = `${Number(current.histogram).toFixed(2)} | ${Number(current.macdLine).toFixed(2)} | ${Number(current.signalLine).toFixed(2)}`;
        }
        
        const revData = [...allData].reverse();
        renderCharts(revData, revData.map(d => {
            const date = new Date(d.tiempo);
            return isNaN(date) ? "" : date.getHours() + ":" + String(date.getMinutes()).padStart(2, '0');
        }));

        if (statusDot) statusDot.style.color = '#00ff88';
    } catch (e) { 
        console.error("Error en Dashboard:", e);
        if (statusDot) statusDot.style.color = '#ff4d4d'; 
    }
}

// --- ALERTA DE CRUCE DE MACD FILTRADO POR BOLLINGER ---
function checkMACDAlerts(curr, prev) {
    const signalEl = document.getElementById('main-signal');
    if (!signalEl) return;

    const currentSign = Math.sign(curr.histogram);
    const prevSign = Math.sign(prev.histogram);

    if (lastHistSign !== null && currentSign !== prevSign) {
        const esLong = currentSign > 0;
        
        // El flash visual en la interfaz siempre se ejecuta para que veas el cruce técnico
        triggerFlash('main-signal', esLong ? "#00ff88" : "#ff4d4d");
        
        const deltaEl = document.getElementById('delta_val');
        const deltaVal = deltaEl ? parseFloat(deltaEl.textContent) || 0 : 0;
        
        // Condición base de fuerza (ADX o volumen Delta alto)
        if (curr.adx > 18 || Math.abs(deltaVal) > alertThreshold) {
            // APLICACIÓN DEL FILTRO DE BOLLINGER PARA SONIDO
            if (esLong && curr.bbPermiteLong) {
                sonarNotificacion('LONG');
            } else if (!esLong && curr.bbPermiteShort) {
                sonarNotificacion('SHORT');
            } else {
                console.log(`Cruce MACD ${esLong ? 'LONG' : 'SHORT'} bloqueado por Filtro de Bollinger (Riesgo Alto).`);
            }
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

function updateStrategyUI(latest) {
    const signalEl = document.getElementById('main-signal');
    const adxTag = document.getElementById('strength-tag');
    if (!signalEl || !adxTag) return;

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

    const macdCanvas = document.getElementById('macdChart');
    const adxCanvas = document.getElementById('adxChart');
    if (!macdCanvas || !adxCanvas) return; 

    const ctxM = macdCanvas.getContext('2d');
    const hD = data.map(d => Number(d.histogram));
    
    const histogramColors = hD.map((v, idx) => {
        if (idx === 0) return v >= 0 ? '#409C97' : '#ff4d4d'; 
        const prevV = hD[idx - 1]; 
        if (v >= 0) {
            return v >= prevV ? '#409C97' : '#FA6969'; 
        } else {
            return v <= prevV ? '#ff4d4d' : '#53B5AB'; 
        }
    });
    
    if (!macdChart) {
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
    } else {
        macdChart.data.labels = labels;
        macdChart.data.datasets[0].data = hD;
        macdChart.data.datasets[0].backgroundColor = histogramColors; 
        macdChart.data.datasets[1].data = data.map(d => d.macdLine);
        macdChart.data.datasets[2].data = data.map(d => d.signalLine);
        macdChart.update('none');
    }

    const ctxA = adxCanvas.getContext('2d');
    const adxDatasets = [
        { data: data.map(d => d.adx), borderColor: '#f0b90b', borderWidth: 2, pointRadius: 0 },
        { data: data.map(d => d.dmiPlus), borderColor: '#00ff88', borderWidth: 1.5, pointRadius: 0, fill: false },
        { data: data.map(d => d.dmiMinus), borderColor: '#FF584D', borderWidth: 1.5, pointRadius: 0, fill: false }
    ];

    if (!adxChart) {
        adxChart = new Chart(ctxA, {
            type: 'line',
            data: { labels, datasets: adxDatasets },
            options: { ...opt, scales: { y: { min: 0, max: 60 } } }
        });
    } else {
        adxChart.data.labels = labels;
        adxChart.data.datasets[0].data = adxDatasets[0].data;
        adxChart.data.datasets[1].data = adxDatasets[1].data;
        adxChart.data.datasets[1].borderColor = adxDatasets[1].borderColor; 
        adxChart.data.datasets[2].data = adxDatasets[2].data;
        adxChart.data.datasets[2].borderColor = adxDatasets[2].borderColor; 
        adxChart.update('none');
    }
}

// --- LOGICA PRECIO Y PNL ---
async function updateLivePrice() {
    try {
        const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
        const data = await response.json();
        currentPrice = parseFloat(data.price);
        
        const livePriceEl = document.getElementById('live-price');
        if (livePriceEl) {
            livePriceEl.textContent = currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2 });
        }
        
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
    if (pnlEl) {
        pnlEl.textContent = (pnlPercent >= 0 ? "+" : "") + pnlPercent.toFixed(2) + "%";
        pnlEl.style.color = pnlPercent >= 0 ? "#00ff88" : "#ff4d4d";
    }
}

function renderPicosUI() {
    if (!entryData.max || !entryData.min || !entryData.price) return;

    const calcVar = (pico) => {
        let v = ((entryData.type === 'LONG' ? (pico - entryData.price) : (entryData.price - pico)) / entryData.price) * 100 * 20;
        return v.toFixed(2);
    };

    const maxEl = document.getElementById('max-val');
    const minEl = document.getElementById('min-val');
    if (maxEl) maxEl.textContent = `${entryData.max.toFixed(2)} (${calcVar(entryData.max)}%)`;
    if (minEl) minEl.textContent = `${entryData.min.toFixed(2)} (${calcVar(entryData.min)}%)`;
}

function saveTrade(type) {
    entryData = { price: currentPrice, type: type, max: currentPrice, min: currentPrice };
    localStorage.setItem('active_trade', JSON.stringify(entryData));
    showTradeUI();
    renderPicosUI();
}

function showTradeUI() {
    const pnlDispEl = document.getElementById('pnl-display');
    const infoEl = document.getElementById('entry-info');
    if (pnlDispEl) pnlDispEl.style.display = 'block';
    if (infoEl) {
        infoEl.textContent = `${entryData.type} @ ${entryData.price.toFixed(2)}`;
        infoEl.style.color = entryData.type === 'LONG' ? '#00ff88' : '#ff4d4d';
    }
    renderPicosUI();
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

function updateDeltaDisplay() {
    const savedDelta = localStorage.getItem('btcDeltaData');
    if (savedDelta) {
        const data = JSON.parse(savedDelta);
        const lVal = parseCoinGlassValue(data.lStr);
        const sVal = parseCoinGlassValue(data.sStr);
        const delta = lVal - sVal;
        
        const dValEl = document.getElementById('delta_val');
        const lValEl = document.getElementById('long-valor');
        const sValEl = document.getElementById('short-valor');

        if (dValEl) dValEl.textContent = (delta >= 0 ? "+" : "") + (delta/1000).toFixed(2) + "B";
        if (lValEl) lValEl.textContent = data.lStr;
        if (sValEl) sValEl.textContent = data.sStr;
    }
}

function parseCoinGlassValue(str) {
    if(!str) return 0;
    const num = parseFloat(str.replace(/[^0-9.]/g, ''));
    return str.includes('B') ? num * 1000 : num;
}

// --- CONTROLADOR DE ARRANQUE SEGURO ---
document.addEventListener('DOMContentLoaded', () => {
    initAlertControls();
    
    const btnLong = document.getElementById('btn-long');
    const btnShort = document.getElementById('btn-short');
    const btnClear = document.getElementById('btn-clear');

    if (btnLong) btnLong.onclick = () => saveTrade('LONG');
    if (btnShort) btnShort.onclick = () => saveTrade('SHORT');
    if (btnClear) {
        btnClear.onclick = () => {
            localStorage.removeItem('active_trade');
            entryData = { price: 0, type: null, max: 0, min: 0 }; 
            const pnlDisp = document.getElementById('pnl-display');
            if (pnlDisp) pnlDisp.style.display = 'none';
        };
    }

    const savedTrade = localStorage.getItem('active_trade');
    if (savedTrade) {
        entryData = JSON.parse(savedTrade);
        showTradeUI(); 
    } else {
        entryData = { price: 0, type: null, max: 0, min: 0 };
    }

    setInterval(updateDashboard, 1500);
    setInterval(updateLivePrice, 2000);
    setInterval(updateDeltaDisplay, 5000);
    
    updateLivePrice();
    updateDashboard();
});
