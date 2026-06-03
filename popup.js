const WEB_APP_URL = "https://dashboardhtrading.onrender.com/get-indicators";

let macdChart = null, adxChart = null;
let isMuted = false, alertThreshold = 100, lastAlertTime = 0;
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let lastDelta = null;
let lastHistSign = null;
let currentPrice = 0;
let entryData = JSON.parse(localStorage.getItem('active_trade')) || { price: 0, type: null, max: 0, min: 0 };// -- VARIABLES DE MINIMOS Y ALTOS
let isTradeActive = false;
let entryPrice = 0;
let maxReached = 0; // El pico más alto (MFE)
let minReached = 0; // El pico más bajo (MAE)
let tradeType = ""; // "LONG" o "SHORT"

// --- LÓGICA PRECIO, PNL Y BOLLINGER EN FRONTEND (INMUNE A CAÍDAS) ---
let priceHistory = []; // Almacena los últimos 20 precios en tiempo real para el Bollinger local

async function updateLivePrice() {
    try {
        const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
        const data = await response.json();
        currentPrice = parseFloat(data.price);

        // 1. Actualizar precio en pantalla
        const livePriceEl = document.getElementById('live-price');
        if (livePriceEl) {
            livePriceEl.textContent = currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2 });
        }

        // 2. ALTERNATIVA BOLLINGER LOCAL: Añadir precio al historial para cálculo matemático
        priceHistory.push(currentPrice);
        if (priceHistory.length > 20) {
            priceHistory.shift(); // Mantenemos solo los últimos 20 registros (Periodo 20)
        }

        // Si ya tenemos suficientes datos locales, calculamos las bandas sin molestar a Render
        if (priceHistory.length === 20) {
            // Calcular Media Móvil Simple (SMA)
            const sum = priceHistory.reduce((a, b) => a + b, 0);
            const sma = sum / 20;

            // Calcular Desviación Estándar
            const variance = priceHistory.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / 20;
            const stdDev = Math.sqrt(variance);

            // Guardamos las bandas globalmente para que updateStrategyUI() las pueda leer
            window.localBbUpper = sma + (2 * stdDev);
            window.localBbLower = sma - (2 * stdDev);
        }

        // 3. Si hay un trade activo, actualizar PnL y Picos
        if (entryData.type) {
            updatePicos(currentPrice);
            calculatePnL();
        }
    } catch (e) { 
        console.error("Error Binance:", e); 
    }
}

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

// --- CODIGO PARA MINIMO Y MAXIMO----
function startTradeTracking(type, currentPrice) {
    isTradeActive = true;
    tradeType = type;
    entryPrice = currentPrice;
    maxReached = currentPrice;
    minReached = currentPrice;

    console.log(`Trade ${type} iniciado en ${entryPrice}`);
    updateTradeUI(); // Función para refrescar los numeritos en pantalla
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

    // --- DENTRO DE LA FUNCIÓN QUE PROCESA LA RESPUESTA DEL SERVIDOR ---
// (Donde tomas el dato más reciente: const actual = data[0];)

if (current.rsi !== undefined) {
    const rsiVal = Number(current.rsi);
    const rsiElement = document.getElementById('rsi-val');
    const rsiTextElement = document.getElementById('rsi-text');

    // Imprimir el valor numérico
    rsiElement.textContent = rsiVal.toFixed(2);

    // Evaluación de las 5 reglas de negocio de la Estrategia Hotero
    if (rsiVal >= 70) {
        // Regla 5: Sobre compra (Color #35948E)
        rsiTextElement.textContent = "Sobre compra";
        rsiTextElement.style.color = "#35948E";
        rsiElement.style.color = "#35948E";
    } else if (rsiVal >= 55) {
        // Regla 4: Compra fuerte (Color #26a69a)
        rsiTextElement.textContent = "Compra fuerte";
        rsiTextElement.style.color = "#26a69a";
        rsiElement.style.color = "#26a69a";
    } else if (rsiVal > 45 && rsiVal < 55) {
        // Regla 3: Neutral (Color Amarillo #f0b90b o yellow)
        rsiTextElement.textContent = "Neutral";
        rsiTextElement.style.color = "#f0b90b";
        rsiElement.style.color = "#f0b90b";
    } else if (rsiVal <= 30) {
        // Regla 1: Sobre venta (Color Rojo #ff4d4d)
        rsiTextElement.textContent = "Sobre venta";
        rsiTextElement.style.color = "#ff4d4d";
        rsiElement.style.color = "#ff4d4d";
    } else if (rsiVal <= 45) {
        // Regla 2: Venta fuerte (Color Naranja #ff9800)
        rsiTextElement.textContent = "Venta fuerte";
        rsiTextElement.style.color = "#ff9800";
        rsiElement.style.color = "#ff9800";
    }
}    

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

function updateStrategyUI(latest, allData) {
    const signalEl = document.getElementById('main-signal');
    const adxTag = document.getElementById('strength-tag');
    if (!signalEl || !adxTag) return;
    
    const isStrong = latest.adx > 22;
    const histUp = latest.histogram > 0;
    const dmiBull = latest.dmiPlus > latest.dmiMinus;
    
    // Filtros de Bandas de Bollinger calculadas nativamente en el navegador
    let precioEnBandaInferior = false;
    let precioEnBandaSuperior = false;

    if (window.localBbUpper && window.localBbLower) {
        // Filtro con margen de aproximación del 0.05% adaptado al scalping en vivo
        precioEnBandaInferior = currentPrice <= (window.localBbLower * 1.0005);
        precioEnBandaSuperior = currentPrice >= (window.localBbUpper * 0.9995);
    }

    adxTag.textContent = `ADX: ${Number(latest.adx).toFixed(1)}`;
    adxTag.className = isStrong ? 'text-green' : '';

    // Combinación letal: Indicadores de tendencia (Render) + Confirmación de agotamiento por Bollinger (Local)
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

// --- GRÁFICOS (CHART.JS) OPTIMIZADO CON 4 COLORES DE HISTOGRAMA ---
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

    // --- NUEVA LÓGICA DE COLORES DINÁMICOS PARA EL MOMENTUM ---
    const histogramColors = hD.map((v, idx) => {
        // Para la primera barra del gráfico no hay anterior, usamos colores base
        if (idx === 0) return v >= 0 ? '#35948E' : '#ff4d4d'; 

        const prevV = hD[idx - 1]; // Valor de la barra anterior

        if (v >= 0) {
            // Histograma > 0: Verde si sube, Naranja si empieza a caer (pérdida de fuerza alcista)
            return v >= prevV ? '#35948E' : '#FA6969'; 
        } else {
            // Histograma < 0: Rojo si baja, Verde Menta si empieza a subir (pérdida de fuerza bajista)
            return v <= prevV ? '#ff4d4d' : '#26a69a'; // #26a69a es el clásico Verde Menta / Teal de TradingView
        }
    });

    if (!macdChart) {
        macdChart = new Chart(ctxM, {
            data: {
                labels,
                datasets: [
                    { type: 'bar', data: hD, backgroundColor: histogramColors }, // Aplicamos los nuevos colores
                    { type: 'line', data: data.map(d => d.macdLine), borderColor: '#2196f3', borderWidth: 1.5, pointRadius: 0 },
                    { type: 'line', data: data.map(d => d.signalLine), borderColor: '#f0b90b', borderWidth: 1.5, pointRadius: 0 }
                ]
            },
            options: opt
        });
    } else {
        macdChart.data.labels = labels;
        macdChart.data.datasets[0].data = hD;
        macdChart.data.datasets[0].backgroundColor = histogramColors; // Actualizamos los colores en cada refresco
        macdChart.data.datasets[1].data = data.map(d => d.macdLine);
        macdChart.data.datasets[2].data = data.map(d => d.signalLine);
        macdChart.update('none');
    }

    // --- 2. GRÁFICO ADX & DMI (MODIFICADO: Líneas Sólidas y Brillantes) ---
    const ctxA = document.getElementById('adxChart').getContext('2d');

    // Definimos los datasets con la nueva configuración
    const adxDatasets = [
        { 
            // ADX Line - Mantenemos Amarillo Hotero, Sólido
            data: data.map(d => d.adx), 
            borderColor: '#f0b90b', 
            borderWidth: 2, // Ligeramente más gruesa por ser la principal
            pointRadius: 0 
        },
        { 
            // DI+ Line - MODIFICADO: Color Verde Brillante exacto, Línea SÓLIDA
            data: data.map(d => d.dmiPlus), 
            borderColor: '#00ff88', // El verde que pediste
            borderWidth: 1.5, // Grosor intermedio para que se vea claro
            pointRadius: 0,
            fill: false // Aseguramos que no se rellene
            // SE ELIMINÓ: borderDash: [2, 2]
        },
        { 
            // DI- Line - MODIFICADO: Color Rojo Brillante exacto, Línea SÓLIDA
            data: data.map(d => d.dmiMinus), 
            borderColor: '#ff4d4d', // El rojo que pediste
            borderWidth: 1.5, 
            pointRadius: 0,
            fill: false
            // SE ELIMINÓ: borderDash: [2, 2]
        }
    ];

    if (!adxChart) {
        adxChart = new Chart(ctxA, {
            type: 'line',
            data: {
                labels,
                datasets: adxDatasets // Usamos la configuración definida arriba
            },
            options: { ...opt, scales: { y: { min: 0, max: 60 } } }
        });
    } else {
        // Actualización eficiente del gráfico existente
        adxChart.data.labels = labels;
        // Actualizamos las propiedades de estilo por seguridad en cada refresco
        adxChart.data.datasets[0].data = adxDatasets[0].data;
        adxChart.data.datasets[1].data = adxDatasets[1].data;
        adxChart.data.datasets[1].borderColor = adxDatasets[1].borderColor; // Brillo exacto
        adxChart.data.datasets[2].data = adxDatasets[2].data;
        adxChart.data.datasets[2].borderColor = adxDatasets[2].borderColor; // Brillo exacto

        adxChart.update('none');
    }
}


// --- LOGICA PRECIO Y PNL INCLUYENDO PICOS MAXIMO Y MINIMO ---
async function updateLivePrice() {
    try {
        const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
        const data = await response.json();
        currentPrice = parseFloat(data.price);

        // Actualizar precio en pantalla
        document.getElementById('live-price').textContent = currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2 });

        // Si hay un trade activo, actualizar PnL y Picos
        if (entryData.type) {
            updatePicos(currentPrice);
            calculatePnL();
        }
    } catch (e) { console.error("Error Binance:", e); }
}

function updatePicos(price) {
    let updated = false;

    // Si es la primera vez que corre tras presionar el botón
    if (entryData.max === 0) { entryData.max = price; updated = true; }
    if (entryData.min === 0) { entryData.min = price; updated = true; }

    // Lógica de máximos y mínimos
    if (price > entryData.max) { entryData.max = price; updated = true; }
    if (price < entryData.min) { entryData.min = price; updated = true; }

    // Guardar si hubo cambios para no perder los picos al refrescar
    if (updated) {
        localStorage.setItem('active_trade', JSON.stringify(entryData));
        renderPicosUI();
    }
}

function calculatePnL() {
    if (!entryData.price) return;

    // PnL Real (sin apalancamiento aún)
    let pnlBase = ((entryData.type === 'LONG' ? (currentPrice - entryData.price) : (entryData.price - currentPrice)) / entryData.price);
    let pnlPercent = pnlBase * 100 * 20; // x20 aplicado

    const pnlEl = document.getElementById('pnl-val');
    pnlEl.textContent = (pnlPercent >= 0 ? "+" : "") + pnlPercent.toFixed(2) + "%";
    pnlEl.style.color = pnlPercent >= 0 ? "#00ff88" : "#ff4d4d";
}

function renderPicosUI() {
    // Si no hay datos, no intentamos formatear
    if (!entryData.max || !entryData.min || !entryData.price) return;

    // Calculamos la variación de los picos respecto al precio de entrada (x20)
    const calcVar = (pico) => {
        let v = ((entryData.type === 'LONG' ? (pico - entryData.price) : (entryData.price - pico)) / entryData.price) * 100 * 20;
        return v.toFixed(2);
    };

    // Actualizamos los elementos en el HTML con seguridad
    document.getElementById('max-val').textContent = `${entryData.max.toFixed(2)} (${calcVar(entryData.max)}%)`;
    document.getElementById('min-val').textContent = `${entryData.min.toFixed(2)} (${calcVar(entryData.min)}%)`;
}

function saveTrade(type) {
    // Inicializamos con el precio actual y picos en el precio de entrada
    entryData = { 
        price: currentPrice, 
        type: type, 
        max: currentPrice, 
        min: currentPrice 
    };
    localStorage.setItem('active_trade', JSON.stringify(entryData));
    showTradeUI();
    renderPicosUI();
}

document.getElementById('btn-long').onclick = () => saveTrade('LONG');
document.getElementById('btn-short').onclick = () => saveTrade('SHORT');
document.getElementById('btn-clear').onclick = () => {
    localStorage.removeItem('active_trade');
    entryData = { price: 0, type: null, max: 0, min: 0 }; // Reseteo completo
    document.getElementById('pnl-display').style.display = 'none';
};

function showTradeUI() {
    document.getElementById('pnl-display').style.display = 'block';
    const info = document.getElementById('entry-info');
    info.textContent = `${entryData.type} @ ${entryData.price.toFixed(2)}`;
    info.style.color = entryData.type === 'LONG' ? '#00ff88' : '#ff4d4d';
    renderPicosUI();
}

// Al cargar la página:
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
