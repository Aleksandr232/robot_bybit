class RiskManager {
    constructor(config) {
        this.config = config;
        this.dailyLoss = 0;
        this.dailyProfit = 0;
        this.totalDrawdown = 0;
        this.peakBalance = 0;
        this.trades = [];
        this.positions = new Map();
        this.lastResetDate = new Date().toDateString();
    }

    // Проверка дневного лимита убытков
    checkDailyLossLimit() {
        const today = new Date().toDateString();
        
        // Сброс счетчиков в новый день
        if (today !== this.lastResetDate) {
            this.dailyLoss = 0;
            this.dailyProfit = 0;
            this.lastResetDate = today;
        }

        return this.dailyLoss < this.config.riskManagement.dailyLossLimit;
    }

    // Проверка максимальной просадки
    checkMaxDrawdown(currentBalance) {
        if (currentBalance > this.peakBalance) {
            this.peakBalance = currentBalance;
            this.totalDrawdown = 0;
        } else {
            this.totalDrawdown = (this.peakBalance - currentBalance) / this.peakBalance;
        }

        return this.totalDrawdown < this.config.riskManagement.maxDrawdown;
    }

    // Проверка времени торговли
    checkTradingHours() {
        const now = new Date();
        const currentHour = now.getUTCHours();
        const { start, end } = this.config.riskManagement.tradingHours;
        
        return currentHour >= start && currentHour <= end;
    }

    // Расчет размера позиции с учетом уверенности
    calculatePositionSize(balance, symbol, signalStrength, confidence = 50, currentPrice = null) {
        // Базовый размер в долларах
        const baseSizeUSD = balance * this.config.trading.positionSize;
        
        // Корректировка размера в зависимости от силы сигнала и уверенности
        const strengthMultiplier = Math.min(signalStrength * 1.5, 1.5); // Максимум 1.5x
        const confidenceMultiplier = confidence / 100; // От 0 до 1
        
        const adjustedSizeUSD = baseSizeUSD * strengthMultiplier * confidenceMultiplier;
        
        // Минимальный размер позиции в долларах
        const minSizeUSD = 25; // $25
        
        // Максимальный размер позиции в долларах (не более 70% от баланса)
        const maxSizeUSD = balance * 0.7;
        
        // Финальный размер в долларах
        const finalSizeUSD = Math.max(Math.min(adjustedSizeUSD, maxSizeUSD), minSizeUSD);
        
        // Если есть цена, конвертируем в количество токенов
        if (currentPrice && currentPrice > 0) {
            const quantity = finalSizeUSD / currentPrice;
            
            // Округляем до правильного количества знаков после запятой
            const decimals = this.getSymbolDecimals(symbol);
            const roundedQuantity = Math.floor(quantity * Math.pow(10, decimals)) / Math.pow(10, decimals);
            
            // Проверяем минимальное количество
            const minQty = this.getMinQty(symbol);
            const finalQuantity = Math.max(roundedQuantity, minQty);
            
            console.log(`🔍 Расчет размера позиции для ${symbol}:`, {
                finalSizeUSD: finalSizeUSD.toFixed(2),
                currentPrice: currentPrice.toFixed(4),
                rawQuantity: quantity.toFixed(6),
                decimals: decimals,
                roundedQuantity: roundedQuantity.toFixed(4),
                minQty: minQty,
                finalQuantity: finalQuantity.toFixed(4)
            });
            
            return {
                sizeUSD: finalSizeUSD,
                quantity: finalQuantity,
                price: currentPrice
            };
        }
        
        // Если цены нет, возвращаем размер в долларах
        return {
            sizeUSD: finalSizeUSD,
            quantity: finalSizeUSD,
            price: 1
        };
    }

    // Получение количества знаков после запятой для символа
    getSymbolDecimals(symbol) {
        const decimalsMap = {
            'BTCUSDT': 3,   // 0.001 BTC
            'ETHUSDT': 2,   // 0.01 ETH
            'ETCUSDT': 2,   // 0.01 ETC
            'XRPUSDT': 0,   // 1 XRP (целые числа)
            'ADAUSDT': 1,   // 0.1 ADA
            'DOTUSDT': 2,   // 0.01 DOT
            'LINKUSDT': 2,  // 0.01 LINK
            'LTCUSDT': 3,   // 0.001 LTC
            'BCHUSDT': 3,   // 0.001 BCH
            'EOSUSDT': 1,   // 0.1 EOS
            'TRXUSDT': 0,   // 1 TRX
            'SOLUSDT': 2,   // 0.01 SOL
            'AVAXUSDT': 2,  // 0.01 AVAX
            'FARTCOINUSDT': 0, // 1 FARTCOIN (целые числа)
            'BNBUSDT': 3,   // 0.001 BNB
            'TRUMPUSDT': 0, // 1 TRUMP (целые числа)
            'TONUSDT': 2    // 0.01 TON
        };
        
        return decimalsMap[symbol] || 2; // По умолчанию 2 знака
    }

    // Получение минимального количества для символа
    getMinQty(symbol) {
        const minQtyMap = {
            'BTCUSDT': 0.001,   // 0.001 BTC
            'ETHUSDT': 0.01,    // 0.01 ETH
            'ETCUSDT': 0.02,    // 0.02 ETC
            'XRPUSDT': 5,       // 5 XRP (целые числа)
            'ADAUSDT': 0.1,     // 0.1 ADA
            'DOTUSDT': 0.01,    // 0.01 DOT
            'LINKUSDT': 0.01,   // 0.01 LINK
            'LTCUSDT': 0.001,   // 0.001 LTC
            'BCHUSDT': 0.001,   // 0.001 BCH
            'EOSUSDT': 0.1,     // 0.1 EOS
            'TRXUSDT': 1,       // 1 TRX
            'SOLUSDT': 0.01,    // 0.01 SOL
            'AVAXUSDT': 0.01,   // 0.01 AVAX
            'FARTCOINUSDT': 1,  // 1 FARTCOIN (целые числа)
            'BNBUSDT': 0.001,   // 0.001 BNB
            'TRUMPUSDT': 1,     // 1 TRUMP (целые числа)
            'TONUSDT': 0.01     // 0.01 TON
        };
        
        return minQtyMap[symbol] || 0.01;
    }

    // ==================== СТОП-ЛОССЫ И ТЕЙК-ПРОФИТЫ ====================

    // Расчет стоп-лосса на основе процента риска
    calculateStopLoss(entryPrice, side, riskPercent = null) {
        const defaultRisk = this.config.trading.stopLoss || 0.02; // 2% по умолчанию
        const risk = riskPercent || defaultRisk;
        
        if (side === 'Buy') {
            // Для лонга: стоп-лосс ниже цены входа
            return entryPrice * (1 - risk);
        } else {
            // Для шорта: стоп-лосс выше цены входа
            return entryPrice * (1 + risk);
        }
    }

    // Расчет тейк-профита на основе соотношения риск/прибыль
    calculateTakeProfit(entryPrice, side, stopLoss, riskRewardRatio = null) {
        const defaultRatio = this.config.trading.riskRewardRatio || 2; // 1:2 по умолчанию
        const ratio = riskRewardRatio || defaultRatio;
        
        const riskDistance = Math.abs(entryPrice - stopLoss);
        
        if (side === 'Buy') {
            // Для лонга: тейк-профит выше цены входа
            return entryPrice + (riskDistance * ratio);
        } else {
            // Для шорта: тейк-профит ниже цены входа
            return entryPrice - (riskDistance * ratio);
        }
    }

    // Установка стоп-лосса для существующей позиции
    setStopLoss(symbol, stopLossPrice, isTrailing = false) {
        const position = this.positions.get(symbol);
        if (!position) {
            console.log(`❌ Позиция ${symbol} не найдена для установки стоп-лосса`);
            return false;
        }

        // Валидация стоп-лосса
        if (!this.validateStopLoss(position, stopLossPrice)) {
            console.log(`❌ Некорректный стоп-лосс для ${symbol}: ${stopLossPrice}`);
            return false;
        }

        position.stopLoss = stopLossPrice;
        position.isTrailingStop = isTrailing;
        
        if (isTrailing) {
            position.trailingStopDistance = Math.abs(position.entryPrice - stopLossPrice);
            position.highestPrice = position.side === 'Buy' ? position.entryPrice : stopLossPrice;
            position.lowestPrice = position.side === 'Sell' ? position.entryPrice : stopLossPrice;
        }

        console.log(`✅ Стоп-лосс установлен для ${symbol}: ${stopLossPrice} (трейлинг: ${isTrailing})`);
        return true;
    }

    // Валидация стоп-лосса
    validateStopLoss(position, stopLossPrice) {
        const { side, entryPrice } = position;
        
        if (side === 'Buy') {
            // Для лонга стоп-лосс должен быть ниже цены входа
            return stopLossPrice < entryPrice;
        } else {
            // Для шорта стоп-лосс должен быть выше цены входа
            return stopLossPrice > entryPrice;
        }
    }

    // Обновление трейлинг стоп-лосса
    updateTrailingStop(symbol, currentPrice) {
        const position = this.positions.get(symbol);
        if (!position || !position.isTrailingStop) return false;

        const { side, trailingStopDistance } = position;
        let newStopLoss = null;

        if (side === 'Buy') {
            // Для лонга: обновляем только если цена растет
            if (currentPrice > position.highestPrice) {
                position.highestPrice = currentPrice;
                newStopLoss = currentPrice - trailingStopDistance;
                
                // Проверяем, что новый стоп-лосс выше текущего
                if (newStopLoss > position.stopLoss) {
                    position.stopLoss = newStopLoss;
                    console.log(`📈 Трейлинг стоп-лосс обновлен для ${symbol}: ${newStopLoss.toFixed(4)}`);
                    return true;
                }
            }
        } else {
            // Для шорта: обновляем только если цена падает
            if (currentPrice < position.lowestPrice) {
                position.lowestPrice = currentPrice;
                newStopLoss = currentPrice + trailingStopDistance;
                
                // Проверяем, что новый стоп-лосс ниже текущего
                if (newStopLoss < position.stopLoss) {
                    position.stopLoss = newStopLoss;
                    console.log(`📉 Трейлинг стоп-лосс обновлен для ${symbol}: ${newStopLoss.toFixed(4)}`);
                    return true;
                }
            }
        }

        return false;
    }

    // Проверка всех стоп-лоссов и тейк-профитов
    checkAllStopLossesAndTakeProfits(currentPrices) {
        const positionsToClose = [];
        
        for (const [symbol, position] of this.positions) {
            const currentPrice = currentPrices[symbol];
            if (!currentPrice) continue;

            // Обновляем трейлинг стоп-лоссы
            this.updateTrailingStop(symbol, currentPrice);

            // Проверяем стоп-лосс
            const stopLossHit = this.checkStopLossHit(position, currentPrice);
            if (stopLossHit) {
                positionsToClose.push({
                    symbol,
                    action: 'close',
                    reason: 'stop_loss',
                    price: currentPrice,
                    stopLossPrice: position.stopLoss
                });
                continue;
            }

            // Проверяем тейк-профит
            const takeProfitHit = this.checkTakeProfitHit(position, currentPrice);
            if (takeProfitHit) {
                positionsToClose.push({
                    symbol,
                    action: 'close',
                    reason: 'take_profit',
                    price: currentPrice,
                    takeProfitPrice: position.takeProfit
                });
            }
        }

        return positionsToClose;
    }

    // Проверка срабатывания стоп-лосса
    checkStopLossHit(position, currentPrice) {
        if (!position.stopLoss) return false;

        const { side } = position;
        
        if (side === 'Buy') {
            return currentPrice <= position.stopLoss;
        } else {
            return currentPrice >= position.stopLoss;
        }
    }

    // Проверка срабатывания тейк-профита
    checkTakeProfitHit(position, currentPrice) {
        if (!position.takeProfit) return false;

        const { side } = position;
        
        if (side === 'Buy') {
            return currentPrice >= position.takeProfit;
        } else {
            return currentPrice <= position.takeProfit;
        }
    }

    // Получение информации о стоп-лоссах и тейк-профитах
    getStopLossInfo(symbol) {
        const position = this.positions.get(symbol);
        if (!position) return null;

        return {
            symbol,
            side: position.side,
            entryPrice: position.entryPrice,
            currentStopLoss: position.stopLoss,
            currentTakeProfit: position.takeProfit,
            isTrailingStop: position.isTrailingStop,
            trailingStopDistance: position.trailingStopDistance,
            riskPercent: position.stopLoss ? 
                ((Math.abs(position.entryPrice - position.stopLoss) / position.entryPrice) * 100).toFixed(2) : null,
            rewardPercent: position.takeProfit ? 
                ((Math.abs(position.takeProfit - position.entryPrice) / position.entryPrice) * 100).toFixed(2) : null
        };
    }

    // Получение всех активных стоп-лоссов
    getAllStopLosses() {
        const stopLosses = [];
        
        for (const [symbol, position] of this.positions) {
            if (position.stopLoss) {
                stopLosses.push(this.getStopLossInfo(symbol));
            }
        }
        
        return stopLosses;
    }

    // ==================== УПРАВЛЕНИЕ ПОЗИЦИЯМИ ====================

    // Проверка максимального количества позиций
    canOpenNewPosition() {
        return this.positions.size < this.config.trading.maxPositions;
    }

    // Добавление позиции с автоматическим расчетом стоп-лосса и тейк-профита
    addPosition(symbol, side, size, entryPrice, customStopLoss = null, customTakeProfit = null, riskPercent = null) {
        // Рассчитываем стоп-лосс и тейк-профит если не указаны
        const stopLoss = customStopLoss || this.calculateStopLoss(entryPrice, side, riskPercent);
        const takeProfit = customTakeProfit || this.calculateTakeProfit(entryPrice, side, stopLoss);

        const position = {
            symbol,
            side,
            size,
            entryPrice,
            stopLoss,
            takeProfit,
            timestamp: Date.now(),
            status: 'open',
            isTrailingStop: false,
            trailingStopDistance: null,
            highestPrice: side === 'Buy' ? entryPrice : null,
            lowestPrice: side === 'Sell' ? entryPrice : null
        };

        this.positions.set(symbol, position);
        
        console.log(`✅ Позиция открыта ${symbol}:`, {
            side,
            size,
            entryPrice: entryPrice.toFixed(4),
            stopLoss: stopLoss.toFixed(4),
            takeProfit: takeProfit.toFixed(4),
            riskPercent: ((Math.abs(entryPrice - stopLoss) / entryPrice) * 100).toFixed(2) + '%'
        });
        
        return position;
    }

    // Закрытие позиции
    closePosition(symbol, exitPrice, reason = 'manual') {
        const position = this.positions.get(symbol);
        if (!position) return null;

        const pnl = this.calculatePnL(position, exitPrice);
        position.exitPrice = exitPrice;
        position.exitTime = Date.now();
        position.status = 'closed';
        position.reason = reason;
        position.pnl = pnl;

        // Обновление статистики
        if (pnl > 0) {
            this.dailyProfit += pnl;
        } else {
            this.dailyLoss += Math.abs(pnl);
        }

        this.trades.push(position);
        this.positions.delete(symbol);

        console.log(`🔒 Позиция закрыта ${symbol}:`, {
            reason,
            exitPrice: exitPrice.toFixed(4),
            pnl: pnl.toFixed(2),
            duration: ((Date.now() - position.timestamp) / 1000 / 60).toFixed(1) + ' мин'
        });

        return position;
    }

    // Расчет прибыли/убытка
    calculatePnL(position, currentPrice) {
        const { side, size, entryPrice } = position;
        
        if (side === 'Buy') {
            return (currentPrice - entryPrice) * size;
        } else {
            return (entryPrice - currentPrice) * size;
        }
    }

    // Проверка стоп-лосса и тейк-профита (обновленная версия)
    checkStopLossAndTakeProfit(symbol, currentPrice) {
        const position = this.positions.get(symbol);
        if (!position) return null;

        // Обновляем трейлинг стоп-лосс если активен
        this.updateTrailingStop(symbol, currentPrice);

        // Проверяем стоп-лосс
        if (this.checkStopLossHit(position, currentPrice)) {
            return { 
                action: 'close', 
                reason: 'stop_loss', 
                price: currentPrice,
                stopLossPrice: position.stopLoss,
                isTrailing: position.isTrailingStop
            };
        }

        // Проверяем тейк-профит
        if (this.checkTakeProfitHit(position, currentPrice)) {
            return { 
                action: 'close', 
                reason: 'take_profit', 
                price: currentPrice,
                takeProfitPrice: position.takeProfit
            };
        }

        return null;
    }

    // ==================== СТАТИСТИКА И АНАЛИЗ ====================

    // Получение статистики торговли
    getTradingStats() {
        const totalTrades = this.trades.length;
        const winningTrades = this.trades.filter(trade => trade.pnl > 0).length;
        const losingTrades = this.trades.filter(trade => trade.pnl < 0).length;
        
        const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;
        const totalPnL = this.trades.reduce((sum, trade) => sum + trade.pnl, 0);
        
        const avgWin = winningTrades > 0 ? 
            this.trades.filter(trade => trade.pnl > 0).reduce((sum, trade) => sum + trade.pnl, 0) / winningTrades : 0;
        
        const avgLoss = losingTrades > 0 ? 
            this.trades.filter(trade => trade.pnl < 0).reduce((sum, trade) => sum + trade.pnl, 0) / losingTrades : 0;

        return {
            totalTrades,
            winningTrades,
            losingTrades,
            winRate: winRate * 100,
            totalPnL,
            dailyLoss: this.dailyLoss,
            dailyProfit: this.dailyProfit,
            totalDrawdown: this.totalDrawdown * 100,
            avgWin,
            avgLoss,
            profitFactor: avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0,
            openPositions: this.positions.size
        };
    }

    // Проверка всех условий для открытия позиции
    canTrade(symbol, signalStrength, currentBalance, confidence = 50, currentPrice = null) {
        const checks = {
            dailyLossLimit: this.checkDailyLossLimit(),
            maxDrawdown: this.checkMaxDrawdown(currentBalance),
            tradingHours: this.checkTradingHours(),
            maxPositions: this.canOpenNewPosition(),
            signalStrength: signalStrength >= this.config.trading.minSignalStrength,
            confidence: confidence >= this.config.trading.minConfidence
        };

        const canTrade = Object.values(checks).every(check => check === true);
        
        return {
            canTrade,
            checks,
            positionSize: canTrade ? this.calculatePositionSize(currentBalance, symbol, signalStrength, confidence, currentPrice) : null
        };
    }

    // Получение активных позиций
    getActivePositions() {
        return Array.from(this.positions.values());
    }

    // Проверка необходимости закрытия позиций по времени
    checkTimeBasedCloses() {
        const positionsToClose = [];
        const now = Date.now();
        const maxHoldTime = 24 * 60 * 60 * 1000; // 24 часа

        for (const [symbol, position] of this.positions) {
            if (now - position.timestamp > maxHoldTime) {
                positionsToClose.push({ symbol, reason: 'time_limit' });
            }
        }

        return positionsToClose;
    }

    // Анализ риска портфеля
    analyzePortfolioRisk() {
        const positions = this.getActivePositions();
        const totalExposure = positions.reduce((sum, pos) => sum + (pos.entryPrice * pos.size), 0);
        
        return {
            totalExposure,
            positionCount: positions.length,
            maxExposure: this.config.trading.maxPositions * 1000, // Предполагаем $1000 на позицию
            riskLevel: totalExposure > 5000 ? 'high' : totalExposure > 2000 ? 'medium' : 'low'
        };
    }

    // ==================== ДОПОЛНИТЕЛЬНЫЕ МЕТОДЫ ====================

    // Получение детальной информации о позиции
    getPositionDetails(symbol) {
        const position = this.positions.get(symbol);
        if (!position) return null;

        return {
            ...position,
            stopLossInfo: this.getStopLossInfo(symbol),
            currentPnL: this.calculatePnL(position, position.entryPrice), // Можно передать текущую цену
            duration: Date.now() - position.timestamp
        };
    }

    // Изменение стоп-лосса для существующей позиции
    modifyStopLoss(symbol, newStopLoss, isTrailing = false) {
        return this.setStopLoss(symbol, newStopLoss, isTrailing);
    }

    // Изменение тейк-профита для существующей позиции
    modifyTakeProfit(symbol, newTakeProfit) {
        const position = this.positions.get(symbol);
        if (!position) {
            console.log(`❌ Позиция ${symbol} не найдена для изменения тейк-профита`);
            return false;
        }

        position.takeProfit = newTakeProfit;
        console.log(`✅ Тейк-профит изменен для ${symbol}: ${newTakeProfit}`);
        return true;
    }

    // Получение сводки по всем позициям
    getPositionsSummary() {
        const positions = this.getActivePositions();
        const summary = {
            totalPositions: positions.length,
            longPositions: positions.filter(p => p.side === 'Buy').length,
            shortPositions: positions.filter(p => p.side === 'Sell').length,
            positionsWithStopLoss: positions.filter(p => p.stopLoss).length,
            trailingStops: positions.filter(p => p.isTrailingStop).length,
            totalExposure: positions.reduce((sum, pos) => sum + (pos.entryPrice * pos.size), 0)
        };

        return summary;
    }
}

module.exports = RiskManager;