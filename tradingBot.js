const BybitWebSocket = require('./bybitWebSocket');
const BybitRestApi = require('./bybitRestApi');
const TechnicalAnalysis = require('./technicalAnalysis');
const RiskManager = require('./riskManager');
const PerformanceMonitor = require('./performanceMonitor');
const LogManager = require('./logManager');
const config = require('./config');
const winston = require('winston');

// Настройка логирования
const logger = winston.createLogger({
    level: config.logging.level,
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ 
            filename: config.logging.file,
            maxsize: config.logging.maxSize,
            maxFiles: config.logging.maxFiles
        }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

class TradingBot {
    constructor() {
        // WebSocket для получения kline данных
        this.ws = new BybitWebSocket(config.websocket);
        
        // REST API для торговых операций
        this.api = new BybitRestApi(config.demo);
        
        this.technicalAnalysis = new TechnicalAnalysis();
        this.riskManager = new RiskManager(config);
        this.performanceMonitor = new PerformanceMonitor();
        
        this.logManager = new LogManager();
        this.isRunning = false;
        this.balance = 10000; // Начальный баланс для демо
        this.performanceStats = {
            startTime: Date.now(),
            totalTrades: 0,
            profitableTrades: 0,
            totalProfit: 0
        };
        
        // Переменные для тестового режима
        this.lastTestSignalTime = null;
        this.testModeEnabled = config.trading.testMode.enabled;

        // Автоматическое переподключение WebSocket каждые 5 часов
        this.wsReconnectInterval = null;
        this.wsReconnectIntervalMs = 5 * 60 * 60 * 1000; // 5 часов в миллисекундах
        this.lastWsReconnectTime = Date.now();

        // Переопределяем методы WebSocket для обработки данных
        this.setupWebSocketHandlers();
    }

    // Настройка обработчиков WebSocket
    setupWebSocketHandlers() {
        this.ws.onKlineData = (message) => this.handleKlineData(message);
    }

    // Запуск бота
    async start() {
        try {
            logger.info('🚀 Запуск торгового бота...');
            
            // Проверка статуса API
            const apiStatus = await this.api.checkApiStatus();
            if (!apiStatus) {
                throw new Error('API недоступен');
            }
            
            // Подключение к WebSocket для kline данных
            await this.ws.connectPublic();
            
            // Подписка на kline данные для всех символов одновременно
            this.ws.subscribeMultipleKlines(config.symbols, config.intervals.short);
            
            // Получение начального баланса через REST API
            await this.updateBalance();
            
            this.isRunning = true;
            this.lastWsReconnectTime = Date.now();
            logger.info('✅ Торговый бот запущен успешно');
            
            // Запуск основного цикла торговли
            this.startTradingLoop();
            
            // Запуск автоматического переподключения WebSocket
            this.startAutoWebSocketReconnect();
            
            // Запуск автоматической очистки логов
            this.logManager.startAutoCleanup();
            
        } catch (error) {
            logger.error('❌ Ошибка запуска бота:', error);
            throw error;
        }
    }

    // Остановка бота
    async stop() {
        logger.info('🛑 Остановка торгового бота...');
        this.isRunning = false;
        this.stopAutoWebSocketReconnect();
        this.logManager.stopAutoCleanup();
        this.ws.close();
        logger.info('✅ Торговый бот остановлен');
    }

    // Запуск автоматического переподключения WebSocket
    startAutoWebSocketReconnect() {
        if (this.wsReconnectInterval) {
            clearInterval(this.wsReconnectInterval);
        }

        this.wsReconnectInterval = setInterval(() => {
            this.performWebSocketReconnect();
        }, this.wsReconnectIntervalMs);

        const nextReconnectTime = new Date(this.lastWsReconnectTime + this.wsReconnectIntervalMs);
        logger.info(`🔄 Автоматическое переподключение WebSocket настроено (каждые 5 часов). Следующее переподключение: ${nextReconnectTime.toLocaleString('ru-RU')}`);
    }

    // Остановка автоматического переподключения WebSocket
    stopAutoWebSocketReconnect() {
        if (this.wsReconnectInterval) {
            clearInterval(this.wsReconnectInterval);
            this.wsReconnectInterval = null;
            logger.info('🛑 Автоматическое переподключение WebSocket отключено');
        }
    }

    // Выполнение переподключения WebSocket
    async performWebSocketReconnect() {
        try {
            logger.info('🔄 ВЫПОЛНЯЕМ ПЕРЕПОДКЛЮЧЕНИЕ WEBSOCKET...');
            
            // Генерируем краткий отчет
            const stats = this.riskManager.getTradingStats();
            logger.info('📊 Статистика перед переподключением:', {
                openPositions: stats.openPositions,
                totalTrades: stats.totalTrades,
                winRate: stats.winRate.toFixed(1) + '%',
                totalPnL: stats.totalPnL.toFixed(2)
            });
            
            // Закрываем старое WebSocket соединение
            logger.info('🔒 Закрываем старое WebSocket соединение...');
            this.ws.close();
            
            // Небольшая пауза для полного закрытия
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Создаем новое WebSocket соединение
            logger.info('🔌 Создаем новое WebSocket соединение...');
            this.ws = new BybitWebSocket(config.websocket);
            this.setupWebSocketHandlers();
            
            // Подключаемся
            await this.ws.connectPublic();
            
            // Восстанавливаем подписки
            logger.info('📊 Восстанавливаем подписки на kline данные...');
            this.ws.subscribeMultipleKlines(config.symbols, config.intervals.short);
            
            this.lastWsReconnectTime = Date.now();
            logger.info('✅ WebSocket успешно переподключен');
            
        } catch (error) {
            logger.error('❌ Ошибка при переподключении WebSocket:', error);
            // Пробуем переподключиться через 5 минут
            setTimeout(() => {
                this.performWebSocketReconnect();
            }, 300000);
        }
    }

    // Graceful shutdown
    async gracefulShutdown() {
        logger.info('🔄 Graceful shutdown...');
        
        // Останавливаем торговый цикл
        this.isRunning = false;
        
        // Закрываем все открытые позиции (опционально)
        const openPositions = this.riskManager.getActivePositions();
        if (openPositions.length > 0) {
            logger.info(`🔒 Закрываем ${openPositions.length} открытых позиций...`);
            for (const position of openPositions) {
                try {
                    const currentPrice = this.technicalAnalysis.getCurrentPrice(position.symbol);
                    if (currentPrice) {
                        await this.closePosition(position.symbol, currentPrice, 'graceful_shutdown');
                    }
                } catch (error) {
                    logger.error(`❌ Ошибка закрытия позиции ${position.symbol}:`, error);
                }
            }
        }
        
        // Закрываем WebSocket соединения
        this.ws.close();
        
        // Останавливаем автоматическое переподключение WebSocket
        this.stopAutoWebSocketReconnect();
        
        // Останавливаем очистку логов
        this.logManager.stopAutoCleanup();
        
        logger.info('✅ Graceful shutdown завершен');
    }

    // Ручное переподключение WebSocket (доступно через API)
    async manualWebSocketReconnect() {
        logger.info('🔄 РУЧНОЕ ПЕРЕПОДКЛЮЧЕНИЕ WEBSOCKET...');
        await this.performWebSocketReconnect();
    }

    // Основной цикл торговли
    startTradingLoop() {
        const tradingInterval = setInterval(async () => {
            if (!this.isRunning) {
                clearInterval(tradingInterval);
                return;
            }

            try {
                await this.analyzeAndTrade();
            } catch (error) {
                logger.error('Ошибка в торговом цикле:', error);
            }
        }, 30000); // Анализ каждые 30 секунд
    }

    // Анализ рынка и торговля
    async analyzeAndTrade() {
        // Проверяем состояние WebSocket соединения
        const wsStatus = this.ws.getConnectionStatus();
        if (!wsStatus.isConnected || wsStatus.timeSinceLastData > 300000) { // 5 минут
            logger.warn('⚠️ Проблемы с WebSocket соединением:', wsStatus);
        }

        if (this.testModeEnabled) {
            logger.info('🧪 ТЕСТОВЫЙ РЕЖИМ АКТИВЕН - принудительная генерация сигналов');
        }
        logger.info('📊 Начинаем комплексный анализ рынка...');
        
        // СНАЧАЛА проверяем открытые позиции на смену тренда (защита прибыли)
        await this.checkOpenPositionsForTrendReversal();
        
        for (const symbol of config.symbols) {
            try {
                // Получение исторических данных для анализа
                await this.getHistoricalData(symbol);
                
                // Комплексный анализ рынка
                const marketAnalysis = await this.performMarketAnalysis(symbol);
                
                // Принятие торгового решения на основе анализа
                const tradingDecision = this.makeTradingDecision(symbol, marketAnalysis);
                
                // Выполнение торгового решения
                await this.executeTradingDecision(symbol, tradingDecision);
                
            } catch (error) {
                logger.error(`Ошибка анализа ${symbol}:`, error);
            }
        }
        
        // Обновление баланса
        await this.updateBalance();
        
        // Логирование статистики
        this.logPerformanceStats();
        
        // Генерация ежедневного отчета (каждые 24 часа)
        const now = new Date();
        if (now.getHours() === 0 && now.getMinutes() < 1) {
            this.generateDailyReport();
        }
    }

    // Проверка открытых позиций на смену тренда (защита прибыли)
    async checkOpenPositionsForTrendReversal() {
        const openPositions = this.riskManager.getActivePositions();
        
        if (openPositions.length === 0) {
            return; // Нет открытых позиций
        }

        logger.info(`🔍 Проверяем ${openPositions.length} открытых позиций на смену тренда...`);

        for (const position of openPositions) {
            try {
                const symbol = position.symbol;
                const currentPrice = this.technicalAnalysis.getCurrentPrice(symbol);
                
                if (!currentPrice) {
                    logger.warn(`⚠️ Не удалось получить текущую цену для ${symbol}`);
                    continue;
                }

                // Рассчитываем текущий PnL
                const pnl = this.riskManager.calculatePnL(position, currentPrice);
                const pnlPercent = (pnl / (position.entryPrice * position.size)) * 100;

                // Получаем технический анализ для этого символа
                const signal = this.technicalAnalysis.analyzeSignal(symbol);
                
                // Получаем долгосрочный и краткосрочный тренд
                const dailySymbol = `${symbol}_DAILY`;
                const longTermTrend = this.technicalAnalysis.analyzeLongTermTrend(dailySymbol);
                const shortTermTrend = this.analyzeTrend(symbol);

                // Проверяем смену тренда
                const trendReversal = this.detectTrendReversal(position, signal, longTermTrend, shortTermTrend, pnlPercent);

                if (trendReversal.shouldClose) {
                    logger.warn(`⚠️ ОБНАРУЖЕНА СМЕНА ТРЕНДА для ${symbol}:`, {
                        position: position.side,
                        currentPnL: pnl.toFixed(2),
                        pnlPercent: pnlPercent.toFixed(2) + '%',
                        reason: trendReversal.reason,
                        reversalStrength: trendReversal.strength.toFixed(2),
                        technicalSignal: signal.signal,
                        longTermDirection: longTermTrend.direction,
                        shortTermDirection: shortTermTrend.direction
                    });

                    // Закрываем позицию для защиты прибыли
                    logger.info(`💰 ЗАКРЫВАЕМ ПОЗИЦИЮ ${symbol} ДЛЯ ЗАЩИТЫ ПРИБЫЛИ`);
                    await this.closePosition(symbol, currentPrice, `trend_reversal: ${trendReversal.reason}`);
                    
                    // Логируем результат
                    if (pnl > 0) {
                        logger.info(`✅ Прибыль зафиксирована: +${pnl.toFixed(2)} USDT (${pnlPercent.toFixed(2)}%)`);
                    } else {
                        logger.info(`📉 Убыток минимизирован: ${pnl.toFixed(2)} USDT (${pnlPercent.toFixed(2)}%)`);
                    }
                } else {
                    // Позиция в порядке, продолжаем держать
                    logger.info(`✅ Позиция ${symbol} в порядке: ${position.side}, PnL: ${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);
                }

            } catch (error) {
                logger.error(`❌ Ошибка проверки позиции ${position.symbol}:`, error);
            }
        }
    }

    // Определение смены тренда для открытой позиции
    detectTrendReversal(position, signal, longTermTrend, shortTermTrend, pnlPercent) {
        const side = position.side; // 'Buy' или 'Sell'
        let shouldClose = false;
        let reason = '';
        let strength = 0;

        // Критерии для смены тренда
        const indicators = {
            technicalSignal: 0,
            longTermTrend: 0,
            shortTermTrend: 0,
            rsi: 0,
            macd: 0,
            confidence: 0
        };

        // 1. Проверка технического сигнала
        if (side === 'Buy' && signal.signal === 'sell') {
            indicators.technicalSignal = signal.strength * 0.3; // 30% веса
            reason += 'технический сигнал на продажу, ';
        } else if (side === 'Sell' && signal.signal === 'buy') {
            indicators.technicalSignal = signal.strength * 0.3;
            reason += 'технический сигнал на покупку, ';
        }

        // 2. Проверка долгосрочного тренда (высокий вес)
        if (longTermTrend && longTermTrend.direction !== 'neutral') {
            if (side === 'Buy' && longTermTrend.direction === 'bearish' && longTermTrend.confidence > 60) {
                indicators.longTermTrend = (longTermTrend.confidence / 100) * 0.35; // 35% веса
                reason += 'долгосрочный медвежий тренд, ';
            } else if (side === 'Sell' && longTermTrend.direction === 'bullish' && longTermTrend.confidence > 60) {
                indicators.longTermTrend = (longTermTrend.confidence / 100) * 0.35;
                reason += 'долгосрочный бычий тренд, ';
            }
        }

        // 3. Проверка краткосрочного тренда
        if (shortTermTrend && shortTermTrend.direction !== 'neutral') {
            if (side === 'Buy' && shortTermTrend.direction === 'bearish') {
                indicators.shortTermTrend = shortTermTrend.strength * 0.2; // 20% веса
                reason += 'краткосрочный медвежий тренд, ';
            } else if (side === 'Sell' && shortTermTrend.direction === 'bullish') {
                indicators.shortTermTrend = shortTermTrend.strength * 0.2;
                reason += 'краткосрочный бычий тренд, ';
            }
        }

        // 4. Проверка RSI (экстремальные значения)
        if (signal.details && signal.details.rsi_value) {
            const rsi = signal.details.rsi_value;
            if (side === 'Buy' && rsi > 75) {
                indicators.rsi = 0.075; // 7.5% веса
                reason += 'RSI перекуплен, ';
            } else if (side === 'Sell' && rsi < 25) {
                indicators.rsi = 0.075;
                reason += 'RSI перепродан, ';
            }
        }

        // 5. Проверка MACD (пересечение сигнальной линии)
        if (signal.details && signal.details.macd_value) {
            const macd = signal.details.macd_value;
            if (side === 'Buy' && macd.macd < macd.signal && macd.histogram < 0) {
                indicators.macd = 0.075; // 7.5% веса
                reason += 'MACD медвежье пересечение, ';
            } else if (side === 'Sell' && macd.macd > macd.signal && macd.histogram > 0) {
                indicators.macd = 0.075;
                reason += 'MACD бычье пересечение, ';
            }
        }

        // 6. Учитываем уверенность сигнала
        if (signal.confidence < 30) {
            indicators.confidence = 0; // Низкая уверенность - не закрываем
        } else {
            indicators.confidence = (signal.confidence / 100) * 0.025; // 2.5% веса
        }

        // Рассчитываем общую силу разворота
        strength = Object.values(indicators).reduce((sum, val) => sum + val, 0);

        // Проверяем, включена ли защита прибыли
        const profitProtection = config.trading.profitProtection;
        
        if (!profitProtection || !profitProtection.enabled) {
            // Защита прибыли отключена
            return { shouldClose: false, reason: 'защита прибыли отключена', strength, indicators, pnlPercent };
        }

        // ЗАЩИТА ПРИБЫЛИ: Если есть хорошая прибыль и признаки разворота - закрываем
        if (pnlPercent > profitProtection.minProfitPercent && strength > profitProtection.trendReversalThreshold) {
            shouldClose = true;
            reason = `Защита прибыли: ${reason}сила разворота ${(strength * 100).toFixed(1)}%`;
        }
        // КРИТИЧЕСКАЯ СМЕНА ТРЕНДА: Если сила разворота очень высокая - закрываем в любом случае
        else if (strength > profitProtection.criticalReversalThreshold) {
            shouldClose = true;
            reason = `Критическая смена тренда: ${reason}сила ${(strength * 100).toFixed(1)}%`;
        }
        // ЗАЩИТА ОТ БОЛЬШИХ УБЫТКОВ: Если убыток близок к стоп-лоссу и есть признаки разворота
        else if (pnlPercent < profitProtection.lossMinimizationPercent && strength > profitProtection.lossMinimizationThreshold) {
            shouldClose = true;
            reason = `Минимизация убытка: ${reason}сила разворота ${(strength * 100).toFixed(1)}%`;
        }

        return {
            shouldClose,
            reason: reason.slice(0, -2), // Убираем последнюю запятую
            strength,
            indicators,
            pnlPercent
        };
    }

    // Получение исторических данных
    async getHistoricalData(symbol) {
        try {
            // Получаем краткосрочные данные (1 минута) для текущего анализа
            const shortTermData = await this.api.getKlineData(symbol, config.intervals.short, 200);
            
            for (const candle of shortTermData) {
                this.technicalAnalysis.addCandle(symbol, {
                    start: parseInt(candle[0]),
                    open: candle[1],
                    high: candle[2],
                    low: candle[3],
                    close: candle[4],
                    volume: candle[5]
                });
            }
            
            logger.info(`📊 Загружено ${shortTermData.length} краткосрочных свечей для ${symbol}`);
            
            // Получаем дневные данные для долгосрочного анализа тренда
            if (config.technicalAnalysis.trendAnalysis.dailyAnalysis.enabled) {
                const dailyData = await this.api.getKlineData(symbol, config.intervals.daily, 300);
                
                // Добавляем дневные данные с префиксом для разделения
                const dailySymbol = `${symbol}_DAILY`;
                for (const candle of dailyData) {
                    this.technicalAnalysis.addCandle(dailySymbol, {
                        start: parseInt(candle[0]),
                        open: candle[1],
                        high: candle[2],
                        low: candle[3],
                        close: candle[4],
                        volume: candle[5]
                    });
                }
                
                logger.info(`📈 Загружено ${dailyData.length} дневных свечей для долгосрочного анализа ${symbol}`);
            }
            
        } catch (error) {
            logger.error(`❌ Ошибка получения исторических данных для ${symbol}:`, error);
            // В случае ошибки используем симулированные данные
            const mockData = this.generateMockKlineData(symbol);
            for (const candle of mockData) {
                this.technicalAnalysis.addCandle(symbol, candle);
            }
        }
    }

    // Генерация тестовых данных свечей
    generateMockKlineData(symbol) {
        const data = [];
        const basePrice = symbol === 'BTCUSDT' ? 45000 : symbol === 'ETHUSDT' ? 3000 : 0.5;
        let currentPrice = basePrice;
        
        for (let i = 0; i < 100; i++) {
            const change = (Math.random() - 0.5) * 0.02; // ±1% изменение
            currentPrice *= (1 + change);
            
            const high = currentPrice * (1 + Math.random() * 0.01);
            const low = currentPrice * (1 - Math.random() * 0.01);
            const open = i === 0 ? currentPrice : data[i-1].close;
            const close = currentPrice;
            
            data.push({
                start: Date.now() - (100 - i) * 60000, // 1 минута назад
                open: open.toFixed(8),
                high: high.toFixed(8),
                low: low.toFixed(8),
                close: close.toFixed(8),
                volume: (Math.random() * 1000 + 100).toFixed(2)
            });
        }
        
        return data;
    }

    // Выполнение торговой операции
    async executeTrade(symbol, signal) {
        try {
            logger.info(`🚀 Начинаем выполнение торговой операции для ${symbol}:`, {
                signal: signal.signal,
                strength: signal.strength?.toFixed(3),
                confidence: signal.confidence?.toFixed(1),
                currentBalance: this.balance.toFixed(2)
            });
            
            const currentPrice = this.technicalAnalysis.getCurrentPrice(symbol);
            if (!currentPrice) {
                logger.error(`❌ Не удалось получить текущую цену для ${symbol}`);
                return;
            }

            const positionSizeData = this.riskManager.calculatePositionSize(this.balance, symbol, signal.strength, signal.confidence, currentPrice);
            const positionSize = positionSizeData.quantity;
            const side = signal.signal === 'buy' ? 'Buy' : 'Sell';
            
            // Расчет стоп-лосса и тейк-профита
            const stopLoss = side === 'Buy' 
                ? currentPrice * (1 - config.trading.stopLoss)
                : currentPrice * (1 + config.trading.stopLoss);
                
            const takeProfit = side === 'Buy'
                ? currentPrice * (1 + config.trading.takeProfit)
                : currentPrice * (1 - config.trading.takeProfit);

            logger.info(`📊 Параметры сделки для ${symbol}:`, {
                side: side,
                currentPrice: currentPrice.toFixed(4),
                positionSize: positionSize.toFixed(4),
                positionSizeUSD: positionSizeData.sizeUSD.toFixed(2),
                stopLoss: stopLoss.toFixed(4),
                takeProfit: takeProfit.toFixed(4),
                stopLossPercent: (config.trading.stopLoss * 100).toFixed(1) + '%',
                takeProfitPercent: (config.trading.takeProfit * 100).toFixed(1) + '%',
                riskRewardRatio: (config.trading.takeProfit / config.trading.stopLoss).toFixed(1) + ':1'
            });

            // Дополнительная проверка размера позиции
            logger.info(`🔍 Финальная проверка параметров ордера для ${symbol}:`, {
                symbol: symbol,
                side: side,
                positionSize: positionSize,
                positionSizeType: typeof positionSize,
                positionSizeString: positionSize.toString(),
                currentPrice: currentPrice.toFixed(4),
                sizeUSD: positionSizeData.sizeUSD.toFixed(2)
            });

            // Проверяем, что размер позиции больше минимального
            const minQty = this.riskManager.getMinQty(symbol);
            if (positionSize < minQty) {
                logger.error(`❌ Размер позиции ${positionSize} меньше минимального ${minQty} для ${symbol}`);
                return;
            }

            // Размещение ордера с TP/SL через REST API
            logger.info(`📤 Размещаем ордер с TP/SL для ${symbol}...`);
            const orderResult = await this.api.placeOrderWithTPSL(
                symbol, 
                side, 
                positionSize, 
                currentPrice, 
                takeProfit, 
                stopLoss, 
                'Market'
            );
            
            logger.info(`📥 Результат размещения ордера для ${symbol}:`, {
                retCode: orderResult.retCode,
                retMsg: orderResult.retMsg,
                success: orderResult.retCode === 0
            });
            
            if (orderResult.retCode === 0) {
                // Добавление позиции в риск-менеджер
                this.riskManager.addPosition(symbol, side, positionSize, currentPrice, stopLoss, takeProfit);
                
                // Запись в монитор производительности
                this.performanceMonitor.recordTrade(symbol, side, positionSize, currentPrice, stopLoss, takeProfit, signal);
                
               
                
                logger.info(`✅ УСПЕШНО ОТКРЫТА ПОЗИЦИЯ ${symbol}:`, {
                    side: side,
                    quantity: positionSize.toFixed(4),
                    sizeUSD: positionSizeData.sizeUSD.toFixed(2),
                    entryPrice: currentPrice.toFixed(4),
                    stopLoss: stopLoss.toFixed(4),
                    takeProfit: takeProfit.toFixed(4),
                    signalStrength: signal.strength?.toFixed(3),
                    signalConfidence: signal.confidence?.toFixed(1),
                    isTestMode: this.testModeEnabled,
                    timestamp: new Date().toISOString()
                });
                
                this.performanceStats.totalTrades++;
            } else {
                logger.error(`❌ ОШИБКА РАЗМЕЩЕНИЯ ОРДЕРА для ${symbol}:`, {
                    retCode: orderResult.retCode,
                    retMsg: orderResult.retMsg,
                    symbol: symbol,
                    side: side,
                    size: positionSize.toFixed(2)
                });
            }
            
        } catch (error) {
            logger.error(`❌ КРИТИЧЕСКАЯ ОШИБКА выполнения торговой операции для ${symbol}:`, {
                error: error.message,
                stack: error.stack,
                symbol: symbol,
                signal: signal
            });
        }
    }


    // Закрытие позиции
    async closePosition(symbol, price, reason) {
        try {
            logger.info(`🔒 Начинаем закрытие позиции для ${symbol}:`, {
                reason: reason,
                currentPrice: price.toFixed(4),
                timestamp: new Date().toISOString()
            });
            
            const position = this.riskManager.closePosition(symbol, price, reason);
            if (!position) {
                logger.warn(`⚠️ Позиция для ${symbol} не найдена или уже закрыта`);
                return;
            }

            logger.info(`📊 Параметры закрытия позиции ${symbol}:`, {
                side: position.side,
                size: position.size.toFixed(2),
                entryPrice: position.entryPrice.toFixed(4),
                exitPrice: price.toFixed(4),
                pnl: position.pnl.toFixed(2),
                pnlPercent: ((position.pnl / (position.entryPrice * position.size)) * 100).toFixed(2) + '%',
                holdTime: ((Date.now() - position.timestamp) / 1000 / 60).toFixed(1) + ' мин',
                reason: reason
            });

            // Размещение ордера на закрытие через REST API
            const closeSide = position.side === 'Buy' ? 'Sell' : 'Buy';
            logger.info(`📤 Размещаем ордер на закрытие для ${symbol}...`);
            const closeResult = await this.api.closePosition(symbol, position.side, position.size);
            
            logger.info(`📥 Результат закрытия позиции для ${symbol}:`, {
                retCode: closeResult.retCode,
                retMsg: closeResult.retMsg,
                success: closeResult.retCode === 0
            });
            
            if (closeResult.retCode === 0) {
                // Запись в монитор производительности
                this.performanceMonitor.recordTradeClose(symbol, price, position.pnl, reason);
                
                logger.info(`✅ УСПЕШНО ЗАКРЫТА ПОЗИЦИЯ ${symbol}:`, {
                    reason: reason,
                    pnl: position.pnl.toFixed(2),
                    pnlPercent: ((position.pnl / (position.entryPrice * position.size)) * 100).toFixed(2) + '%',
                    entryPrice: position.entryPrice.toFixed(4),
                    exitPrice: price.toFixed(4),
                    holdTime: ((Date.now() - position.timestamp) / 1000 / 60).toFixed(1) + ' мин',
                    side: position.side,
                    size: position.size.toFixed(2),
                    timestamp: new Date().toISOString()
                });
                
                if (position.pnl > 0) {
                    this.performanceStats.profitableTrades++;
                    this.performanceStats.totalProfit += position.pnl;
                    logger.info(`💰 Прибыльная сделка! Общая прибыль: ${this.performanceStats.totalProfit.toFixed(2)}`);
                } else {
                    logger.info(`📉 Убыточная сделка. Общий убыток: ${Math.abs(position.pnl).toFixed(2)}`);
                }
            } else {
                logger.error(`❌ ОШИБКА ЗАКРЫТИЯ ПОЗИЦИИ для ${symbol}:`, {
                    retCode: closeResult.retCode,
                    retMsg: closeResult.retMsg,
                    symbol: symbol,
                    side: position.side,
                    size: position.size.toFixed(2),
                    reason: reason
                });
            }
            
        } catch (error) {
            logger.error(`❌ КРИТИЧЕСКАЯ ОШИБКА закрытия позиции ${symbol}:`, {
                error: error.message,
                stack: error.stack,
                symbol: symbol,
                reason: reason,
                price: price
            });
        }
    }

    // Обработка данных свечей
    handleKlineData(message) {
        console.log('🔍 Получено сообщение kline:', JSON.stringify(message, null, 2));
        
        if (message.data && message.data.length > 0) {
            const kline = message.data[0];
            
            // Извлекаем символ из topic: "kline.5.BTCUSDT"
            let symbol = null;
            if (message.topic) {
                const topicParts = message.topic.split('.');
                if (topicParts.length >= 3) {
                    symbol = topicParts[2];
                }
            }
            
            if (symbol) {
                // Правильная структура данных Bybit kline
                this.technicalAnalysis.addCandle(symbol, {
                    start: parseInt(kline.start),
                    open: kline.open,
                    high: kline.high,
                    low: kline.low,
                    close: kline.close,
                    volume: kline.volume
                });
                
                logger.info(`📊 Получена новая свеча для ${symbol}: ${kline.close} (завершена: ${kline.confirm})`);
            } else {
                logger.warn('⚠️ Не удалось определить символ для kline данных:', message);
            }
        }
    }

    // Обновление баланса через REST API
    async updateBalance() {
        try {
            const balanceData = await this.api.getWalletBalance();
            if (balanceData.retCode === 0 && balanceData.result.list.length > 0) {
                const usdtAccount = balanceData.result.list.find(account => account.accountType === 'UNIFIED');
                if (usdtAccount && usdtAccount.coin.length > 0) {
                    const usdtCoin = usdtAccount.coin.find(coin => coin.coin === 'USDT');
                    if (usdtCoin) {
                        this.balance = parseFloat(usdtCoin.walletBalance);
                        logger.info(`💰 Обновление баланса: ${this.balance} USDT`);
                    }
                }
            }
        } catch (error) {
            logger.error('❌ Ошибка обновления баланса:', error);
        }
    }

    // Логирование статистики производительности
    logPerformanceStats() {
        const stats = this.riskManager.getTradingStats();
        const winRate = this.performanceStats.totalTrades > 0 
            ? (this.performanceStats.profitableTrades / this.performanceStats.totalTrades * 100).toFixed(2)
            : 0;

        logger.info('📊 Статистика производительности:', {
            winRate: `${winRate}%`,
            totalTrades: this.performanceStats.totalTrades,
            profitableTrades: this.performanceStats.profitableTrades,
            totalProfit: this.performanceStats.totalProfit.toFixed(2),
            currentBalance: this.balance.toFixed(2),
            openPositions: stats.openPositions,
            dailyPnL: (stats.dailyProfit - stats.dailyLoss).toFixed(2)
        });
    }

    // Комплексный анализ рынка
    async performMarketAnalysis(symbol) {
        logger.info(`🔍 Выполняем комплексный анализ для ${symbol}...`);
        
        // 1. Технический анализ
        const technicalSignal = this.technicalAnalysis.analyzeSignal(symbol);
        logger.info(`📈 Технический анализ ${symbol}:`, {
            signal: technicalSignal.signal,
            strength: technicalSignal.strength?.toFixed(3),
            confidence: technicalSignal.confidence?.toFixed(1),
            rsi: technicalSignal.details?.rsi_value?.toFixed(1),
            macd: technicalSignal.details?.macd_value?.macd?.toFixed(4),
            trend: technicalSignal.details?.trend?.trend
        });
        
        // 2. Анализ тренда (обновленный с долгосрочным анализом)
        const trendAnalysis = this.analyzeTrend(symbol);
        logger.info(`📊 Анализ тренда ${symbol}:`, {
            direction: trendAnalysis.direction,
            strength: trendAnalysis.strength?.toFixed(3),
            quality: trendAnalysis.quality,
            change: trendAnalysis.change?.toFixed(2) + '%',
            shortTermDirection: trendAnalysis.shortTermDirection,
            recommendation: trendAnalysis.recommendation,
            longTermTrend: {
                direction: trendAnalysis.longTermTrend?.direction,
                confidence: trendAnalysis.longTermTrend?.confidence?.toFixed(1),
                recommendation: trendAnalysis.longTermTrend?.recommendation,
                strength: trendAnalysis.longTermTrend?.strength?.toFixed(3)
            },
            trendAlignment: {
                aligned: trendAnalysis.trendAlignment?.aligned,
                longTermConfidence: trendAnalysis.trendAlignment?.longTermConfidence?.toFixed(1),
                shortTermStrength: trendAnalysis.trendAlignment?.shortTermStrength?.toFixed(3)
            }
        });
        
        // 3. Анализ волатильности
        const volatilityAnalysis = this.analyzeVolatility(symbol);
        logger.info(`⚡ Анализ волатильности ${symbol}:`, {
            level: volatilityAnalysis.level,
            recommendation: volatilityAnalysis.recommendation,
            value: volatilityAnalysis.value?.toFixed(2) + '%'
        });
        
        // 4. Анализ объемов
        const volumeAnalysis = this.analyzeVolume(symbol);
        logger.info(`📊 Анализ объемов ${symbol}:`, {
            trend: volumeAnalysis.trend,
            strength: volumeAnalysis.strength?.toFixed(2),
            ratio: volumeAnalysis.ratio?.toFixed(2),
            current: volumeAnalysis.current?.toFixed(0),
            average: volumeAnalysis.average?.toFixed(0)
        });
        
        // 5. Анализ рыночной структуры
        const marketStructure = this.analyzeMarketStructure(symbol);
        logger.info(`🏗️ Рыночная структура ${symbol}:`, {
            pattern: marketStructure.pattern,
            strength: marketStructure.strength?.toFixed(3),
            higherHighs: marketStructure.higherHighs,
            lowerHighs: marketStructure.lowerHighs,
            higherLows: marketStructure.higherLows,
            lowerLows: marketStructure.lowerLows
        });
        
        // 6. Анализ существующих позиций
        const positionAnalysis = this.analyzeExistingPositions(symbol);
        if (positionAnalysis.exists) {
            logger.info(`💼 Анализ позиции ${symbol}:`, {
                action: positionAnalysis.action,
                reason: positionAnalysis.reason,
                pnl: positionAnalysis.pnl?.toFixed(2),
                pnlPercent: positionAnalysis.pnlPercent?.toFixed(2) + '%',
                holdTime: positionAnalysis.holdTime?.toFixed(1) + ' мин',
                entryPrice: positionAnalysis.entryPrice?.toFixed(4),
                currentPrice: positionAnalysis.currentPrice?.toFixed(4)
            });
        } else {
            logger.info(`💼 Позиция ${symbol}: отсутствует`);
        }
        
        const analysis = {
            symbol,
            timestamp: Date.now(),
            technical: technicalSignal,
            trend: trendAnalysis,
            volatility: volatilityAnalysis,
            volume: volumeAnalysis,
            marketStructure,
            position: positionAnalysis,
            overallScore: 0,
            recommendation: 'hold'
        };
        
        // Расчет общего скора
        analysis.overallScore = this.calculateOverallScore(analysis);
        
        // Определение рекомендации
        analysis.recommendation = this.determineRecommendation(analysis);
        
        // Детальное логирование финального анализа (обновленное с долгосрочным трендом)
        logger.info(`📊 ФИНАЛЬНЫЙ АНАЛИЗ ${symbol}:`, {
            recommendation: analysis.recommendation,
            overallScore: analysis.overallScore.toFixed(2),
            technicalWeight: (analysis.technical.strength * analysis.technical.confidence / 100 * 0.4).toFixed(2),
            trendWeight: (analysis.trend.direction !== 'neutral' ? analysis.trend.strength * (analysis.trend.quality === 'high' ? 1 : 0.5) * 0.25 : 0).toFixed(2),
            volatilityWeight: (analysis.volatility.recommendation === 'good' ? 0.15 : analysis.volatility.recommendation === 'caution' ? 0.1 : 0).toFixed(2),
            volumeWeight: (analysis.volume.trend === 'increasing' && analysis.volume.strength > 1.2 ? 0.1 : analysis.volume.strength > 1.5 ? 0.05 : 0).toFixed(2),
            structureWeight: (analysis.marketStructure.pattern !== 'sideways' ? analysis.marketStructure.strength * 0.1 : 0).toFixed(2),
            longTermTrendAnalysis: {
                direction: analysis.trend.longTermTrend?.direction,
                confidence: analysis.trend.longTermTrend?.confidence?.toFixed(1),
                recommendation: analysis.trend.longTermTrend?.recommendation,
                strength: analysis.trend.longTermTrend?.strength?.toFixed(3),
                timeFrames: {
                    short: analysis.trend.longTermTrend?.timeFrames?.short?.direction,
                    medium: analysis.trend.longTermTrend?.timeFrames?.medium?.direction,
                    long: analysis.trend.longTermTrend?.timeFrames?.long?.direction
                },
                emaAnalysis: {
                    direction: analysis.trend.longTermTrend?.emaAnalysis?.direction,
                    confidence: analysis.trend.longTermTrend?.emaAnalysis?.confidence?.toFixed(1)
                }
            },
            trendAlignment: {
                aligned: analysis.trend.trendAlignment?.aligned,
                longTermConfidence: analysis.trend.trendAlignment?.longTermConfidence?.toFixed(1),
                shortTermStrength: analysis.trend.trendAlignment?.shortTermStrength?.toFixed(3)
            }
        });
        
        return analysis;
    }

    // Анализ тренда (обновленный с долгосрочным анализом)
    analyzeTrend(symbol) {
        // Используем новый долгосрочный анализ тренда с дневными данными
        const dailySymbol = `${symbol}_DAILY`;
        const longTermTrend = this.technicalAnalysis.analyzeLongTermTrend(dailySymbol);
        
        // Дополнительно получаем краткосрочный анализ для сравнения
        const history = this.technicalAnalysis.getPriceHistory(symbol);
        if (history.length < 50) return { 
            strength: 0, 
            direction: 'neutral', 
            quality: 'low',
            longTermTrend: longTermTrend,
            recommendation: 'insufficient_data'
        };
        
        const recent = history.slice(-20);
        const prices = recent.map(c => c.close);
        
        // Простой анализ краткосрочного тренда
        const firstPrice = prices[0];
        const lastPrice = prices[prices.length - 1];
        const change = (lastPrice - firstPrice) / firstPrice;
        
        // Анализ последовательности максимумов и минимумов
        let higherHighs = 0;
        let lowerLows = 0;
        
        for (let i = 1; i < recent.length - 1; i++) {
            if (recent[i].high > recent[i-1].high) higherHighs++;
            if (recent[i].low < recent[i-1].low) lowerLows++;
        }
        
        let shortTermDirection = 'neutral';
        let strength = Math.abs(change);
        
        if (change > 0.02 && higherHighs > lowerLows) {
            shortTermDirection = 'bullish';
        } else if (change < -0.02 && lowerLows > higherHighs) {
            shortTermDirection = 'bearish';
        }
        
        const quality = strength > 0.05 ? 'high' : strength > 0.02 ? 'medium' : 'low';
        
        // Определяем финальное направление на основе долгосрочного тренда
        let finalDirection = shortTermDirection;
        let finalQuality = quality;
        let recommendation = 'hold';
        
        // Если долгосрочный тренд сильный, он имеет приоритет
        if (longTermTrend.direction !== 'neutral' && longTermTrend.confidence > 50) {
            if (longTermTrend.direction === shortTermDirection) {
                // Согласованность - усиливаем сигнал
                finalDirection = longTermTrend.direction;
                finalQuality = 'high';
                recommendation = longTermTrend.recommendation;
            } else if (longTermTrend.direction !== shortTermDirection && shortTermDirection !== 'neutral') {
                // Противоречие - снижаем качество
                finalDirection = 'neutral';
                finalQuality = 'low';
                recommendation = 'mixed_signals';
            } else {
                // Краткосрочный тренд нейтральный - используем долгосрочный
                finalDirection = longTermTrend.direction;
                finalQuality = longTermTrend.confidence > 70 ? 'high' : 'medium';
                recommendation = longTermTrend.recommendation;
            }
        }
        
        return { 
            strength, 
            direction: finalDirection, 
            quality: finalQuality, 
            change: change * 100,
            shortTermDirection: shortTermDirection,
            longTermTrend: longTermTrend,
            recommendation: recommendation,
            trendAlignment: {
                aligned: longTermTrend.direction === shortTermDirection,
                longTermConfidence: longTermTrend.confidence,
                shortTermStrength: strength
            }
        };
    }

    // Анализ волатильности
    analyzeVolatility(symbol) {
        const history = this.technicalAnalysis.getPriceHistory(symbol);
        if (history.length < 20) return { level: 'unknown', recommendation: 'avoid' };
        
        const recent = history.slice(-20);
        const returns = [];
        
        for (let i = 1; i < recent.length; i++) {
            const returnValue = (recent[i].close - recent[i-1].close) / recent[i-1].close;
            returns.push(Math.abs(returnValue));
        }
        
        const avgVolatility = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const volatilityPercent = avgVolatility * 100;
        
        let level = 'low';
        let recommendation = 'good';
        
        if (volatilityPercent > 3) {
            level = 'high';
            recommendation = 'caution';
        } else if (volatilityPercent > 1.5) {
            level = 'medium';
            recommendation = 'good';
        } else {
            level = 'low';
            recommendation = 'avoid';
        }
        
        return { level, recommendation, value: volatilityPercent };
    }

    // Анализ объемов
    analyzeVolume(symbol) {
        const history = this.technicalAnalysis.getPriceHistory(symbol);
        if (history.length < 20) return { trend: 'unknown', strength: 0 };
        
        const recent = history.slice(-20);
        const volumes = recent.map(c => c.volume);
        const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
        const currentVolume = volumes[volumes.length - 1];
        
        // Анализ тренда объемов
        const firstHalf = volumes.slice(0, 10);
        const secondHalf = volumes.slice(10);
        const firstAvg = firstHalf.reduce((sum, v) => sum + v, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((sum, v) => sum + v, 0) / secondHalf.length;
        
        let trend = 'neutral';
        if (secondAvg > firstAvg * 1.2) trend = 'increasing';
        else if (secondAvg < firstAvg * 0.8) trend = 'decreasing';
        
        const volumeRatio = currentVolume / avgVolume;
        const strength = Math.min(volumeRatio, 3); // Ограничиваем до 3x
        
        return { trend, strength, ratio: volumeRatio, current: currentVolume, average: avgVolume };
    }

    // Анализ рыночной структуры
    analyzeMarketStructure(symbol) {
        const history = this.technicalAnalysis.getPriceHistory(symbol);
        if (history.length < 30) return { pattern: 'unknown', strength: 0 };
        
        const recent = history.slice(-30);
        const highs = recent.map(c => c.high);
        const lows = recent.map(c => c.low);
        
        // Поиск паттернов
        let pattern = 'sideways';
        let strength = 0;
        
        // Анализ последовательных максимумов и минимумов
        let higherHighs = 0;
        let lowerHighs = 0;
        let higherLows = 0;
        let lowerLows = 0;
        
        for (let i = 2; i < recent.length - 2; i++) {
            const current = recent[i];
            const prev = recent[i-1];
            const next = recent[i+1];
            
            // Локальный максимум
            if (current.high > prev.high && current.high > next.high) {
                if (i > 2 && current.high > recent[i-2].high) higherHighs++;
                else if (i > 2) lowerHighs++;
            }
            
            // Локальный минимум
            if (current.low < prev.low && current.low < next.low) {
                if (i > 2 && current.low > recent[i-2].low) higherLows++;
                else if (i > 2) lowerLows++;
            }
        }
        
        if (higherHighs > lowerHighs && higherLows > lowerLows) {
            pattern = 'uptrend';
            strength = (higherHighs + higherLows) / (higherHighs + lowerHighs + higherLows + lowerLows);
        } else if (lowerHighs > higherHighs && lowerLows > higherLows) {
            pattern = 'downtrend';
            strength = (lowerHighs + lowerLows) / (higherHighs + lowerHighs + higherLows + lowerLows);
        }
        
        return { pattern, strength, higherHighs, lowerHighs, higherLows, lowerLows };
    }

    // Анализ существующих позиций
    analyzeExistingPositions(symbol) {
        const position = this.riskManager.positions.get(symbol);
        if (!position) {
            return { exists: false, action: 'none' };
        }
        
        const currentPrice = this.technicalAnalysis.getCurrentPrice(symbol);
        if (!currentPrice) {
            return { exists: true, action: 'hold', reason: 'no_price_data' };
        }
        
        const pnl = this.riskManager.calculatePnL(position, currentPrice);
        const pnlPercent = pnl / (position.entryPrice * position.size);
        
        // Анализ времени удержания позиции
        const holdTime = Date.now() - position.timestamp;
        const maxHoldTime = 24 * 60 * 60 * 1000; // 24 часа
        
        let action = 'hold';
        let reason = 'normal';
        
        // Проверка стоп-лосса и тейк-профита
        if (pnlPercent <= -config.trading.stopLoss) {
            action = 'close';
            reason = 'stop_loss';
        } else if (pnlPercent >= config.trading.takeProfit) {
            action = 'close';
            reason = 'take_profit';
        } else if (holdTime > maxHoldTime) {
            action = 'close';
            reason = 'time_limit';
        }
        
        return {
            exists: true,
            action,
            reason,
            pnl,
            pnlPercent: pnlPercent * 100,
            holdTime: holdTime / 1000 / 60, // в минутах
            entryPrice: position.entryPrice,
            currentPrice
        };
    }

    // Расчет общего скора анализа
    calculateOverallScore(analysis) {
        let score = 0;
        let maxScore = 0;
        
        // Технический анализ (40% веса)
        if (analysis.technical.signal !== 'neutral') {
            const techScore = analysis.technical.strength * analysis.technical.confidence / 100;
            score += techScore * 0.4;
        }
        maxScore += 0.4;
        
        // Тренд (25% веса)
        if (analysis.trend.direction !== 'neutral') {
            const trendScore = analysis.trend.strength * (analysis.trend.quality === 'high' ? 1 : 0.5);
            score += trendScore * 0.25;
        }
        maxScore += 0.25;
        
        // Волатильность (15% веса)
        if (analysis.volatility.recommendation === 'good') {
            score += 0.15;
        } else if (analysis.volatility.recommendation === 'caution') {
            score += 0.1;
        }
        maxScore += 0.15;
        
        // Объемы (10% веса)
        if (analysis.volume.trend === 'increasing' && analysis.volume.strength > 1.2) {
            score += 0.1;
        } else if (analysis.volume.strength > 1.5) {
            score += 0.05;
        }
        maxScore += 0.1;
        
        // Рыночная структура (10% веса)
        if (analysis.marketStructure.pattern !== 'sideways') {
            score += analysis.marketStructure.strength * 0.1;
        }
        maxScore += 0.1;
        
        return maxScore > 0 ? (score / maxScore) * 100 : 0;
    }

    // Определение рекомендации на основе анализа (обновленное с учетом долгосрочного тренда)
    determineRecommendation(analysis) {
        const score = analysis.overallScore;
        const technical = analysis.technical;
        const position = analysis.position;
        const trend = analysis.trend;
        
        // Если есть позиция, анализируем её
        if (position.exists) {
            if (position.action === 'close') {
                return 'close_position';
            }
            return 'hold_position';
        }
        
        // ТЕСТОВЫЙ РЕЖИМ - принудительная генерация сигналов
        if (config.trading.testMode.enabled && config.trading.testMode.forceSignals) {
            return this.generateTestRecommendation(analysis);
        }
        
        // НОВАЯ ЛОГИКА: Приоритет долгосрочному тренду
        const longTermTrend = trend.longTermTrend;
        const trendRecommendation = trend.recommendation;
        
        // Если долгосрочный тренд сильный и согласован с техническими сигналами
        if (longTermTrend && longTermTrend.confidence > 60) {
            // Сильный бычий тренд
            if (longTermTrend.direction === 'bullish' && 
                (trendRecommendation === 'strong_buy' || trendRecommendation === 'moderate_buy')) {
                
                // Дополнительная проверка технических индикаторов
                if (technical.signal === 'buy' || technical.signal === 'neutral') {
                    return 'buy'; // Входим в LONG позицию
                }
            }
            
            // Сильный медвежий тренд
            if (longTermTrend.direction === 'bearish' && 
                (trendRecommendation === 'strong_sell' || trendRecommendation === 'moderate_sell')) {
                
                // Дополнительная проверка технических индикаторов
                if (technical.signal === 'sell' || technical.signal === 'neutral') {
                    return 'sell'; // Входим в SHORT позицию
                }
            }
        }
        
        // Если долгосрочный тренд противоречит техническим сигналам - не торгуем
        if (longTermTrend && longTermTrend.confidence > 50) {
            if ((longTermTrend.direction === 'bullish' && technical.signal === 'sell') ||
                (longTermTrend.direction === 'bearish' && technical.signal === 'buy')) {
                return 'hold'; // Противоречие - не торгуем
            }
        }
        
        // Если нет четкого долгосрочного тренда, используем старую логику
        if (score < 40) {
            return 'hold';
        }
        
        if (technical.signal === 'buy' && score >= 45) {
            return 'buy';
        } else if (technical.signal === 'sell' && score >= 45) {
            return 'sell';
        }
        
        return 'hold';
    }

    // Генерация тестовых рекомендаций
    generateTestRecommendation(analysis) {
        const currentTime = Date.now();
        
        // Проверяем, нужно ли генерировать тестовый сигнал
        if (!this.lastTestSignalTime) {
            this.lastTestSignalTime = currentTime;
        }
        
        
        
        
        
        // Обновляем время последнего тестового сигнала
        this.lastTestSignalTime = currentTime;
        
        // Переопределяем анализ для тестового режима
        analysis.overallScore = testSignal.score;
        analysis.technical.signal = testSignal.signal;
        analysis.technical.strength = testSignal.strength;
        analysis.technical.confidence = testSignal.confidence;
        
        return testSignal.signal;
    }

    // Принятие торгового решения
    makeTradingDecision(symbol, analysis) {
        const decision = {
            symbol,
            action: analysis.recommendation,
            confidence: analysis.overallScore,
            details: analysis,
            timestamp: Date.now()
        };
        
        logger.info(`🤔 Принятие решения для ${symbol}:`, {
            initialRecommendation: analysis.recommendation,
            overallScore: analysis.overallScore.toFixed(2),
            technicalSignal: analysis.technical.signal,
            technicalStrength: analysis.technical.strength?.toFixed(3),
            technicalConfidence: analysis.technical.confidence?.toFixed(1)
        });
        
        // Дополнительная фильтрация (пропускаем в тестовом режиме)
        if (analysis.recommendation === 'buy' || analysis.recommendation === 'sell') {
            if (config.trading.testMode.enabled && config.trading.testMode.overrideFilters) {
                logger.info(`🧪 ТЕСТОВЫЙ РЕЖИМ: Пропускаем фильтрацию для ${symbol}`);
                decision.action = analysis.recommendation;
                decision.reason = 'Тестовый режим - фильтры отключены';
            } else {
                const filteredSignal = this.applyAdvancedFilters(symbol, analysis.technical);
                logger.info(`🔍 Фильтрация сигнала для ${symbol}:`, {
                    passed: filteredSignal.passed,
                    reason: filteredSignal.reason,
                    details: filteredSignal.details
                });
                
                if (!filteredSignal.passed) {
                    decision.action = 'hold';
                    decision.reason = `Отфильтровано: ${filteredSignal.reason}`;
                    logger.warn(`❌ Сигнал отфильтрован для ${symbol}: ${filteredSignal.reason}`);
                } else {
                    logger.info(`✅ Сигнал прошел фильтрацию для ${symbol}`);
                }
            }
        }
        
        logger.info(`🎯 ФИНАЛЬНОЕ РЕШЕНИЕ для ${symbol}:`, {
            action: decision.action,
            confidence: decision.confidence.toFixed(2),
            reason: decision.reason || 'Нет причин для отклонения'
        });
        
        return decision;
    }

    // Выполнение торгового решения
    async executeTradingDecision(symbol, decision) {
        logger.info(`🎯 Торговое решение для ${symbol}: ${decision.action} (уверенность: ${decision.confidence.toFixed(1)}%)`);
        
        switch (decision.action) {
            case 'buy':
                await this.executeBuyDecision(symbol, decision);
                break;
            case 'sell':
                await this.executeSellDecision(symbol, decision);
                break;
            case 'close_position':
                await this.executeCloseDecision(symbol, decision);
                break;
            case 'hold':
            case 'hold_position':
                // Ничего не делаем
                break;
            default:
                logger.warn(`Неизвестное действие: ${decision.action}`);
        }
    }

    // Выполнение решения на покупку
    async executeBuyDecision(symbol, decision) {
        logger.info(`🟢 Выполнение решения на покупку для ${symbol}:`, {
            signalStrength: decision.details.technical.strength?.toFixed(3),
            signalConfidence: decision.details.technical.confidence?.toFixed(1),
            currentBalance: this.balance.toFixed(2)
        });
        
        const currentPrice = this.technicalAnalysis.getCurrentPrice(symbol);
        const canTrade = this.riskManager.canTrade(symbol, decision.details.technical.strength, this.balance, decision.details.technical.confidence, currentPrice);
        
        logger.info(`🔍 Проверка возможности торговли для ${symbol}:`, {
            canTrade: canTrade.canTrade,
            checks: canTrade.checks,
            positionSize: canTrade.positionSize ? {
                quantity: canTrade.positionSize.quantity?.toFixed(4),
                sizeUSD: canTrade.positionSize.sizeUSD?.toFixed(2)
            } : null
        });
        
        if (canTrade.canTrade) {
            logger.info(`💰 Открываем LONG позицию для ${symbol}`, {
                positionSize: canTrade.positionSize ? {
                    quantity: canTrade.positionSize.quantity?.toFixed(4),
                    sizeUSD: canTrade.positionSize.sizeUSD?.toFixed(2)
                } : null,
                signalStrength: decision.details.technical.strength?.toFixed(3),
                signalConfidence: decision.details.technical.confidence?.toFixed(1)
            });
            await this.executeTrade(symbol, decision.details.technical);
        } else {
            logger.warn(`⚠️ Покупка заблокирована для ${symbol}:`, canTrade.checks);
        }
    }

    // Выполнение решения на продажу
    async executeSellDecision(symbol, decision) {
        logger.info(`🔴 Выполнение решения на продажу для ${symbol}:`, {
            signalStrength: decision.details.technical.strength?.toFixed(3),
            signalConfidence: decision.details.technical.confidence?.toFixed(1),
            currentBalance: this.balance.toFixed(2)
        });
        
        const currentPrice = this.technicalAnalysis.getCurrentPrice(symbol);
        const canTrade = this.riskManager.canTrade(symbol, decision.details.technical.strength, this.balance, decision.details.technical.confidence, currentPrice);
        
        logger.info(`🔍 Проверка возможности торговли для ${symbol}:`, {
            canTrade: canTrade.canTrade,
            checks: canTrade.checks,
            positionSize: canTrade.positionSize ? {
                quantity: canTrade.positionSize.quantity?.toFixed(4),
                sizeUSD: canTrade.positionSize.sizeUSD?.toFixed(2)
            } : null
        });
        
        if (canTrade.canTrade) {
            logger.info(`💰 Открываем SHORT позицию для ${symbol}`, {
                positionSize: canTrade.positionSize ? {
                    quantity: canTrade.positionSize.quantity?.toFixed(4),
                    sizeUSD: canTrade.positionSize.sizeUSD?.toFixed(2)
                } : null,
                signalStrength: decision.details.technical.strength?.toFixed(3),
                signalConfidence: decision.details.technical.confidence?.toFixed(1)
            });
            await this.executeTrade(symbol, decision.details.technical);
        } else {
            logger.warn(`⚠️ Продажа заблокирована для ${symbol}:`, canTrade.checks);
        }
    }

    // Выполнение решения на закрытие позиции
    async executeCloseDecision(symbol, decision) {
        logger.info(`🔒 Выполнение решения на закрытие позиции для ${symbol}:`, {
            reason: decision.details.position.reason,
            pnl: decision.details.position.pnl?.toFixed(2),
            pnlPercent: decision.details.position.pnlPercent?.toFixed(2) + '%',
            holdTime: decision.details.position.holdTime?.toFixed(1) + ' мин'
        });
        
        const position = this.riskManager.positions.get(symbol);
        if (position) {
            const currentPrice = this.technicalAnalysis.getCurrentPrice(symbol);
            if (currentPrice) {
                logger.info(`🔒 Закрываем позицию для ${symbol}: ${decision.details.position.reason}`, {
                    entryPrice: position.entryPrice.toFixed(4),
                    currentPrice: currentPrice.toFixed(4),
                    pnl: decision.details.position.pnl?.toFixed(2),
                    pnlPercent: decision.details.position.pnlPercent?.toFixed(2) + '%'
                });
                await this.closePosition(symbol, currentPrice, decision.details.position.reason);
            } else {
                logger.error(`❌ Не удалось получить текущую цену для ${symbol}`);
            }
        } else {
            logger.warn(`⚠️ Позиция для ${symbol} не найдена`);
        }
    }

    // Продвинутая фильтрация сигналов для высокой прибыльности
    applyAdvancedFilters(symbol, signal) {
        const filters = config.trading.filters;
        const details = signal.details;
        let passed = true;
        let reasons = [];

        // 1. Проверка минимальной уверенности
        if (signal.confidence < config.trading.minConfidence) {
            passed = false;
            reasons.push(`Низкая уверенность: ${signal.confidence.toFixed(1)}% < ${config.trading.minConfidence}%`);
        }

        // 2. Проверка подтверждения объемом
        if (filters.requireVolumeConfirmation && details.volume) {
            if (!details.volume.volumeConfirmation) {
                passed = false;
                reasons.push('Отсутствует подтверждение объемом');
            }
        }

        // 3. Проверка волатильности
        if (filters.requireMediumVolatility && details.volatility) {
            if (details.volatility.volatilityRank !== 'medium') {
                passed = false;
                reasons.push(`Неподходящая волатильность: ${details.volatility.volatilityRank}`);
            }
        }

        // 4. Проверка количества подтверждающих индикаторов
        if (filters.minConfirmingIndicators) {
            let confirmingCount = 0;
            
            if (details.rsi && details.rsi.signal === signal.signal) confirmingCount++;
            if (details.macd && details.macd.signal === signal.signal) confirmingCount++;
            if (details.trend && details.trend.trend === (signal.signal === 'buy' ? 'bullish' : 'bearish')) confirmingCount++;
            if (details.bb && details.bb.signal === signal.signal) confirmingCount++;
            if (details.volume && details.volume.obvTrend === (signal.signal === 'buy' ? 'bullish' : 'bearish')) confirmingCount++;

            if (confirmingCount < filters.minConfirmingIndicators) {
                passed = false;
                reasons.push(`Недостаточно подтверждений: ${confirmingCount}/${filters.minConfirmingIndicators}`);
            }
        }

        // 5. Проверка экстремальных условий RSI
        if (filters.avoidExtremeRSI && details.rsi_value) {
            if (details.rsi_value < 20 || details.rsi_value > 80) {
                passed = false;
                reasons.push(`Экстремальный RSI: ${details.rsi_value.toFixed(1)}`);
            }
        }

        // 6. Проверка дивергенции для сильных сигналов
        if (filters.preferDivergence && signal.strength > 0.8) {
            const hasDivergence = (details.rsi && details.rsi.confidence > 30) || 
                                 (details.macd && details.macd.confidence > 30);
            
            if (!hasDivergence) {
                passed = false;
                reasons.push('Отсутствует дивергенция для сильного сигнала');
            }
        }

        // 7. Проверка качества тренда (ослаблено для 40-50% сделок)
        if (details.trend && details.trend.strength < 0.15) {
            passed = false;
            reasons.push(`Слабый тренд: ${details.trend.strength.toFixed(2)}`);
        }

        // 8. Проверка полос Боллинджера (ослаблено для 40-50% сделок)
        if (details.bb && details.bb.bbWidth < 0.005) {
            passed = false;
            reasons.push('Слишком узкие полосы Боллинджера');
        }

        return {
            passed,
            reason: reasons.join(', ') || 'Все фильтры пройдены',
            details: {
                confidence: signal.confidence,
                confirmingIndicators: this.countConfirmingIndicators(signal),
                volumeConfirmation: details.volume?.volumeConfirmation || false,
                volatilityRank: details.volatility?.volatilityRank || 'unknown',
                rsiValue: details.rsi_value,
                trendStrength: details.trend?.strength || 0
            }
        };
    }

    // Подсчет подтверждающих индикаторов
    countConfirmingIndicators(signal) {
        const details = signal.details;
        let count = 0;
        
        if (details.rsi && details.rsi.signal === signal.signal) count++;
        if (details.macd && details.macd.signal === signal.signal) count++;
        if (details.trend && details.trend.trend === (signal.signal === 'buy' ? 'bullish' : 'bearish')) count++;
        if (details.bb && details.bb.signal === signal.signal) count++;
        if (details.volume && details.volume.obvTrend === (signal.signal === 'buy' ? 'bullish' : 'bearish')) count++;
        
        return count;
    }

    // Получение детальной статистики
    getDetailedStats() {
        const tradingStats = this.riskManager.getTradingStats();
        const portfolioRisk = this.riskManager.analyzePortfolioRisk();
        const performanceStats = this.performanceMonitor.getPerformanceStats();
        const signalQuality = this.performanceMonitor.analyzeSignalQuality();
        const recommendations = this.performanceMonitor.getOptimizationRecommendations();
        
        return {
            performance: this.performanceStats,
            trading: tradingStats,
            risk: portfolioRisk,
            advanced: performanceStats,
            signalQuality: signalQuality,
            recommendations: recommendations,
            uptime: Date.now() - this.performanceStats.startTime
        };
    }

    // Генерация ежедневного отчета
    generateDailyReport() {
        const report = this.performanceMonitor.generateDailyReport();
        
        
        
        return report;
    }

   
     // Получение статуса бота
    async getBotStatus() {
        const wsStatus = this.ws.getConnectionStatus();
        const uptime = Date.now() - this.performanceStats.startTime;
        const timeToNextReconnect = this.wsReconnectIntervalMs - (Date.now() - this.lastWsReconnectTime);
        const logStats = await this.logManager.getLogStats();
        
        return {
            isRunning: this.isRunning,
            uptime: Math.floor(uptime / 1000 / 60), // в минутах
            balance: this.balance,
            openPositions: this.riskManager.getActivePositions().length,
            wsConnection: wsStatus,
            autoWebSocketReconnect: {
                enabled: this.wsReconnectInterval !== null,
                timeToNextReconnect: Math.floor(timeToNextReconnect / 1000 / 60), // в минутах
                lastReconnect: new Date(this.lastWsReconnectTime).toLocaleString('ru-RU')
            },
            testMode: {
                enabled: this.testModeEnabled
            },
            performance: this.performanceStats,
            logs: logStats
        };
    }

    // Ручное переподключение WebSocket через API
    async manualReconnect() {
        logger.info('🔄 РУЧНОЕ ПЕРЕПОДКЛЮЧЕНИЕ WEBSOCKET (через API)...');
        await this.performWebSocketReconnect();
    }

    // Ручная очистка логов
    async manualLogCleanup() {
        logger.info('🗂️ РУЧНАЯ ОЧИСТКА ЛОГОВ...');
        await this.logManager.manualCleanup();
    }

    // Получение информации о логах
    async getLogInfo() {
        return await this.logManager.getLogInfo();
    }

    // Получение статистики логов
    async getLogStats() {
        return await this.logManager.getLogStats();
    }

    // Очистка старых архивов
    async cleanupOldLogArchives() {
        logger.info('🗑️ ОЧИСТКА СТАРЫХ АРХИВОВ ЛОГОВ...');
        await this.logManager.cleanupOldArchives();
    }
}

// Запуск бота
if (require.main === module) {
    const bot = new TradingBot();
    
    // Обработка сигналов завершения
    process.on('SIGINT', async () => {
        console.log('\n🛑 Получен сигнал SIGINT (Ctrl+C)...');
        try {
            await bot.gracefulShutdown();
            console.log('✅ Graceful shutdown завершен');
            process.exit(0);
        } catch (error) {
            console.error('❌ Ошибка при graceful shutdown:', error);
            process.exit(1);
        }
    });

    process.on('SIGTERM', async () => {
        console.log('\n🛑 Получен сигнал SIGTERM...');
        try {
            await bot.gracefulShutdown();
            console.log('✅ Graceful shutdown завершен');
            process.exit(0);
        } catch (error) {
            console.error('❌ Ошибка при graceful shutdown:', error);
            process.exit(1);
        }
    });

    // Обработка необработанных исключений
    process.on('uncaughtException', async (error) => {
        console.error('❌ Необработанное исключение:', error);
        try {
            await bot.gracefulShutdown();
        } catch (shutdownError) {
            console.error('❌ Ошибка при emergency shutdown:', shutdownError);
        }
        process.exit(1);
    });

    process.on('unhandledRejection', async (reason, promise) => {
        console.error('❌ Необработанное отклонение Promise:', reason);
        try {
            await bot.gracefulShutdown();
        } catch (shutdownError) {
            console.error('❌ Ошибка при emergency shutdown:', shutdownError);
        }
        process.exit(1);
    });

    // Запуск
    bot.start().catch(error => {
        console.error('❌ Критическая ошибка при запуске:', error);
        process.exit(1);
    });
}

module.exports = TradingBot;
