const { RSI, MACD, SMA, EMA, BollingerBands, Stochastic, WilliamsR, ATR, ADX, CCI, OBV, VWAP } = require('technicalindicators');

class TechnicalAnalysis {
    constructor() {
        this.priceHistory = new Map(); // Хранение истории цен для каждого символа
        this.maxHistoryLength = 500; // Увеличиваем историю для лучшего анализа
        this.supportResistanceLevels = new Map(); // Уровни поддержки и сопротивления
        this.marketStructure = new Map(); // Структура рынка
        this.volumeProfile = new Map(); // Профиль объемов
    }

    // Добавление новой свечи в историю
    addCandle(symbol, candle) {
        if (!this.priceHistory.has(symbol)) {
            this.priceHistory.set(symbol, []);
        }

        const history = this.priceHistory.get(symbol);
        history.push({
            timestamp: candle.start,
            open: parseFloat(candle.open),
            high: parseFloat(candle.high),
            low: parseFloat(candle.low),
            close: parseFloat(candle.close),
            volume: parseFloat(candle.volume)
        });

        // Ограничиваем длину истории
        if (history.length > this.maxHistoryLength) {
            history.shift();
        }
    }

    // Получение истории цен для символа
    getPriceHistory(symbol) {
        return this.priceHistory.get(symbol) || [];
    }

    // Расчет RSI
    calculateRSI(symbol, period = 14) {
        const history = this.getPriceHistory(symbol);
        if (history.length < period + 1) return null;

        const closes = history.map(candle => candle.close);
        const rsi = RSI.calculate({ values: closes, period });
        
        return rsi.length > 0 ? rsi[rsi.length - 1] : null;
    }

    // Расчет MACD
    calculateMACD(symbol, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        const history = this.getPriceHistory(symbol);
        if (history.length < slowPeriod + signalPeriod) return null;

        const closes = history.map(candle => candle.close);
        const macd = MACD.calculate({
            values: closes,
            fastPeriod,
            slowPeriod,
            signalPeriod
        });

        if (macd.length === 0) return null;

        const lastMACD = macd[macd.length - 1];
        return {
            macd: lastMACD.MACD,
            signal: lastMACD.signal,
            histogram: lastMACD.histogram
        };
    }

    // Расчет скользящих средних
    calculateMovingAverages(symbol, periods = [9, 21, 50]) {
        const history = this.getPriceHistory(symbol);
        const closes = history.map(candle => candle.close);
        const result = {};

        periods.forEach(period => {
            if (history.length >= period) {
                const sma = SMA.calculate({ values: closes, period });
                const ema = EMA.calculate({ values: closes, period });
                
                if (sma.length > 0) result[`sma_${period}`] = sma[sma.length - 1];
                if (ema.length > 0) result[`ema_${period}`] = ema[ema.length - 1];
            }
        });

        return result;
    }

    // Расчет полос Боллинджера
    calculateBollingerBands(symbol, period = 20, stdDev = 2) {
        const history = this.getPriceHistory(symbol);
        if (history.length < period) return null;

        const closes = history.map(candle => candle.close);
        const bb = BollingerBands.calculate({
            values: closes,
            period,
            stdDev
        });

        if (bb.length === 0) return null;

        const lastBB = bb[bb.length - 1];
        return {
            upper: lastBB.upper,
            middle: lastBB.middle,
            lower: lastBB.lower
        };
    }

    // Анализ тренда (базовый)
    analyzeTrend(symbol) {
        const mas = this.calculateMovingAverages(symbol, [9, 21, 50]);
        const currentPrice = this.getCurrentPrice(symbol);
        
        if (!currentPrice || !mas.sma_9 || !mas.sma_21 || !mas.sma_50) {
            return { trend: 'neutral', strength: 0 };
        }

        let bullishSignals = 0;
        let bearishSignals = 0;

        // Проверка расположения скользящих средних
        if (mas.sma_9 > mas.sma_21) bullishSignals++;
        else bearishSignals++;

        if (mas.sma_21 > mas.sma_50) bullishSignals++;
        else bearishSignals++;

        // Проверка расположения цены относительно MA
        if (currentPrice > mas.sma_9) bullishSignals++;
        else bearishSignals++;

        if (currentPrice > mas.sma_21) bullishSignals++;
        else bearishSignals++;

        const totalSignals = bullishSignals + bearishSignals;
        const strength = Math.abs(bullishSignals - bearishSignals) / totalSignals;

        let trend = 'neutral';
        if (bullishSignals > bearishSignals) trend = 'bullish';
        else if (bearishSignals > bullishSignals) trend = 'bearish';

        return { trend, strength };
    }

    // Продвинутый долгосрочный анализ тренда
    analyzeLongTermTrend(symbol) {
        const config = require('./config');
        const trendConfig = config.technicalAnalysis.trendAnalysis;
        const history = this.getPriceHistory(symbol);
        
        // Проверяем, достаточно ли данных для анализа
        const minRequiredData = trendConfig.dailyAnalysis?.enabled ? 
            trendConfig.dailyAnalysis.minDays : trendConfig.longTermEMA.slow;
            
        if (history.length < minRequiredData) {
            return { 
                direction: 'neutral', 
                strength: 0, 
                confidence: 0,
                timeFrames: {},
                recommendation: 'insufficient_data',
                dataPoints: history.length,
                requiredData: minRequiredData
            };
        }

        const currentPrice = this.getCurrentPrice(symbol);
        const closes = history.map(candle => candle.close);
        
        // Расчет EMA для разных периодов
        const ema50 = EMA.calculate({ values: closes, period: trendConfig.longTermEMA.fast });
        const ema100 = EMA.calculate({ values: closes, period: trendConfig.longTermEMA.medium });
        const ema200 = EMA.calculate({ values: closes, period: trendConfig.longTermEMA.slow });
        
        if (ema50.length === 0 || ema100.length === 0 || ema200.length === 0) {
            return { 
                direction: 'neutral', 
                strength: 0, 
                confidence: 0,
                timeFrames: {},
                recommendation: 'insufficient_data'
            };
        }

        const currentEMA50 = ema50[ema50.length - 1];
        const currentEMA100 = ema100[ema100.length - 1];
        const currentEMA200 = ema200[ema200.length - 1];

        // Анализ по временным рамкам
        const timeFrames = {
            short: this.analyzeTimeFrameTrend(history, trendConfig.trendPeriods.short, currentPrice, currentEMA50, symbol),
            medium: this.analyzeTimeFrameTrend(history, trendConfig.trendPeriods.medium, currentPrice, currentEMA100, symbol),
            long: this.analyzeTimeFrameTrend(history, trendConfig.trendPeriods.long, currentPrice, currentEMA200, symbol)
        };

        // Анализ расположения EMA
        const emaAnalysis = this.analyzeEMAPosition(currentPrice, currentEMA50, currentEMA100, currentEMA200);
        
        // Расчет общего направления тренда
        const overallTrend = this.calculateOverallTrend(timeFrames, emaAnalysis, trendConfig);
        
        // Определение рекомендации
        const recommendation = this.determineTrendRecommendation(overallTrend, timeFrames, emaAnalysis);
        
        return {
            direction: overallTrend.direction,
            strength: overallTrend.strength,
            confidence: overallTrend.confidence,
            timeFrames: timeFrames,
            emaAnalysis: emaAnalysis,
            recommendation: recommendation,
            details: {
                currentPrice: currentPrice,
                ema50: currentEMA50,
                ema100: currentEMA100,
                ema200: currentEMA200,
                priceVsEMA50: ((currentPrice - currentEMA50) / currentEMA50 * 100).toFixed(2) + '%',
                priceVsEMA100: ((currentPrice - currentEMA100) / currentEMA100 * 100).toFixed(2) + '%',
                priceVsEMA200: ((currentPrice - currentEMA200) / currentEMA200 * 100).toFixed(2) + '%'
            }
        };
    }

    // Анализ тренда для конкретной временной рамки
    analyzeTimeFrameTrend(history, period, currentPrice, ema, symbol = '') {
        if (history.length < period) {
            return { direction: 'neutral', strength: 0, confidence: 0 };
        }

        const recentHistory = history.slice(-period);
        const firstPrice = recentHistory[0].close;
        const lastPrice = recentHistory[recentHistory.length - 1].close;
        
        // Расчет изменения цены за период
        const priceChange = (lastPrice - firstPrice) / firstPrice;
        
        // Анализ последовательности максимумов и минимумов
        const trendStructure = this.analyzeTrendStructure(recentHistory);
        
        // Анализ волатильности
        const volatility = this.calculatePeriodVolatility(recentHistory);
        
        // Определение направления с учетом типа данных (дневные или минутные)
        const config = require('./config');
        const trendConfig = config.technicalAnalysis.trendAnalysis;
        const isDailyData = symbol.includes('_DAILY');
        
        // Пороги для дневных данных выше
        const minChangeThreshold = isDailyData ? 0.05 : 0.02; // 5% для дневных, 2% для минутных
        const strongChangeThreshold = isDailyData ? 0.15 : 0.05; // 15% для дневных, 5% для минутных
        
        let direction = 'neutral';
        let strength = Math.abs(priceChange);
        let confidence = 0;
        
        if (priceChange > minChangeThreshold && trendStructure.bullishSignals > trendStructure.bearishSignals) {
            direction = 'bullish';
            // Для дневных данных увеличиваем базовую уверенность
            const baseConfidence = isDailyData ? 60 : 50;
            confidence = Math.min(baseConfidence + (priceChange * 500), 95);
        } else if (priceChange < -minChangeThreshold && trendStructure.bearishSignals > trendStructure.bullishSignals) {
            direction = 'bearish';
            // Для дневных данных увеличиваем базовую уверенность
            const baseConfidence = isDailyData ? 60 : 50;
            confidence = Math.min(baseConfidence + (Math.abs(priceChange) * 500), 95);
        }
        
        // Учет волатильности в уверенности (для дневных данных волатильность обычно выше)
        const volatilityThreshold = isDailyData ? 0.05 : 0.03;
        if (volatility > volatilityThreshold) {
            confidence *= 0.8; // Снижаем уверенность при высокой волатильности
        }
        
        // Дополнительный бонус за сильные движения в дневных данных
        if (isDailyData && Math.abs(priceChange) > strongChangeThreshold) {
            confidence += 10;
        }
        
        return { direction, strength, confidence, priceChange, trendStructure, volatility };
    }

    // Анализ структуры тренда (максимумы и минимумы)
    analyzeTrendStructure(history) {
        let bullishSignals = 0;
        let bearishSignals = 0;
        
        // Поиск локальных максимумов и минимумов
        for (let i = 2; i < history.length - 2; i++) {
            const current = history[i];
            const prev = history[i-1];
            const next = history[i+1];
            
            // Локальный максимум
            if (current.high > prev.high && current.high > next.high) {
                if (i > 2 && current.high > history[i-2].high) {
                    bullishSignals++;
                } else if (i > 2) {
                    bearishSignals++;
                }
            }
            
            // Локальный минимум
            if (current.low < prev.low && current.low < next.low) {
                if (i > 2 && current.low > history[i-2].low) {
                    bullishSignals++;
                } else if (i > 2) {
                    bearishSignals++;
                }
            }
        }
        
        return { bullishSignals, bearishSignals };
    }

    // Расчет волатильности за период
    calculatePeriodVolatility(history) {
        if (history.length < 2) return 0;
        
        const returns = [];
        for (let i = 1; i < history.length; i++) {
            const returnValue = (history[i].close - history[i-1].close) / history[i-1].close;
            returns.push(Math.abs(returnValue));
        }
        
        const avgReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
        return avgReturn;
    }

    // Анализ расположения EMA
    analyzeEMAPosition(currentPrice, ema50, ema100, ema200) {
        let bullishSignals = 0;
        let bearishSignals = 0;
        let confidence = 0;
        
        // Проверка расположения EMA относительно друг друга
        if (ema50 > ema100) bullishSignals++;
        else bearishSignals++;
        
        if (ema100 > ema200) bullishSignals++;
        else bearishSignals++;
        
        // Проверка расположения цены относительно EMA
        if (currentPrice > ema50) bullishSignals++;
        else bearishSignals++;
        
        if (currentPrice > ema100) bullishSignals++;
        else bearishSignals++;
        
        if (currentPrice > ema200) bullishSignals++;
        else bearishSignals++;
        
        // Расчет уверенности на основе расстояния между EMA
        const ema50_100_distance = Math.abs(ema50 - ema100) / ema100;
        const ema100_200_distance = Math.abs(ema100 - ema200) / ema200;
        
        confidence = Math.min((ema50_100_distance + ema100_200_distance) * 1000, 50);
        
        let direction = 'neutral';
        if (bullishSignals > bearishSignals) direction = 'bullish';
        else if (bearishSignals > bullishSignals) direction = 'bearish';
        
        return { direction, bullishSignals, bearishSignals, confidence };
    }

    // Расчет общего тренда
    calculateOverallTrend(timeFrames, emaAnalysis, trendConfig) {
        let bullishScore = 0;
        let bearishScore = 0;
        let totalConfidence = 0;
        
        // Взвешенный анализ по временным рамкам
        Object.keys(timeFrames).forEach(timeFrame => {
            const weight = trendConfig.timeFrameWeights[timeFrame];
            const frame = timeFrames[timeFrame];
            
            if (frame.direction === 'bullish') {
                bullishScore += frame.strength * weight;
                totalConfidence += frame.confidence * weight;
            } else if (frame.direction === 'bearish') {
                bearishScore += frame.strength * weight;
                totalConfidence += frame.confidence * weight;
            }
        });
        
        // Добавляем анализ EMA
        if (emaAnalysis.direction === 'bullish') {
            bullishScore += 0.2;
            totalConfidence += emaAnalysis.confidence * 0.2;
        } else if (emaAnalysis.direction === 'bearish') {
            bearishScore += 0.2;
            totalConfidence += emaAnalysis.confidence * 0.2;
        }
        
        const strength = Math.abs(bullishScore - bearishScore);
        const confidence = Math.min(totalConfidence, 100);
        
        let direction = 'neutral';
        if (bullishScore > bearishScore && strength > 0.3) {
            direction = 'bullish';
        } else if (bearishScore > bullishScore && strength > 0.3) {
            direction = 'bearish';
        }
        
        return { direction, strength, confidence };
    }

    // Определение рекомендации на основе тренда
    determineTrendRecommendation(overallTrend, timeFrames, emaAnalysis) {
        const { direction, strength, confidence } = overallTrend;
        
        // Недостаточно данных
        if (confidence < 30) {
            return 'insufficient_data';
        }
        
        // Слабый тренд
        if (strength < 0.3) {
            return 'weak_trend';
        }
        
        // Проверяем согласованность временных рамок
        const timeFrameDirections = Object.values(timeFrames).map(tf => tf.direction);
        const consistentDirections = timeFrameDirections.filter(dir => dir === direction).length;
        const consistency = consistentDirections / timeFrameDirections.length;
        
        // Высокая согласованность - сильный сигнал
        if (consistency >= 0.7 && confidence >= 60) {
            return direction === 'bullish' ? 'strong_buy' : 'strong_sell';
        }
        
        // Средняя согласованность - умеренный сигнал
        if (consistency >= 0.5 && confidence >= 40) {
            return direction === 'bullish' ? 'moderate_buy' : 'moderate_sell';
        }
        
        // Низкая согласованность - слабый сигнал
        if (consistency >= 0.3 && confidence >= 30) {
            return direction === 'bullish' ? 'weak_buy' : 'weak_sell';
        }
        
        return 'mixed_signals';
    }

    // Получение текущей цены
    getCurrentPrice(symbol) {
        const history = this.getPriceHistory(symbol);
        return history.length > 0 ? history[history.length - 1].close : null;
    }

    // Продвинутый анализ объемов
    analyzeVolume(symbol) {
        const history = this.getPriceHistory(symbol);
        if (history.length < 20) return null;

        const recentVolumes = history.slice(-20).map(candle => candle.volume);
        const avgVolume = recentVolumes.reduce((sum, vol) => sum + vol, 0) / recentVolumes.length;
        const currentVolume = history[history.length - 1].volume;
        
        // Анализ OBV (On Balance Volume)
        const closes = history.map(candle => candle.close);
        const volumes = history.map(candle => candle.volume);
        const obv = OBV.calculate({ close: closes, volume: volumes });
        
        return {
            volumeRatio: currentVolume / avgVolume,
            obvTrend: obv.length > 1 ? (obv[obv.length - 1] > obv[obv.length - 2] ? 'bullish' : 'bearish') : 'neutral',
            volumeConfirmation: currentVolume > avgVolume * 1.5
        };
    }

    // Анализ волатильности
    calculateVolatility(symbol, period = 20) {
        const history = this.getPriceHistory(symbol);
        if (history.length < period) return null;

        const recentCandles = history.slice(-period);
        const returns = [];
        
        for (let i = 1; i < recentCandles.length; i++) {
            const returnValue = (recentCandles[i].close - recentCandles[i-1].close) / recentCandles[i-1].close;
            returns.push(returnValue);
        }

        const avgReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
        const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
        const volatility = Math.sqrt(variance);

        return {
            volatility: volatility * 100, // В процентах
            atr: this.calculateATR(symbol, period),
            volatilityRank: this.getVolatilityRank(symbol, volatility)
        };
    }

    // Расчет ATR (Average True Range)
    calculateATR(symbol, period = 14) {
        const history = this.getPriceHistory(symbol);
        if (history.length < period + 1) return null;

        const high = history.map(c => c.high);
        const low = history.map(c => c.low);
        const close = history.map(c => c.close);

        const atr = ATR.calculate({ high, low, close, period });
        return atr.length > 0 ? atr[atr.length - 1] : null;
    }

    // Ранжирование волатильности
    getVolatilityRank(symbol, currentVolatility) {
        const history = this.getPriceHistory(symbol);
        if (history.length < 100) return 'medium';

        const volatilities = [];
        for (let i = 20; i < history.length; i += 20) {
            const periodData = history.slice(i - 20, i);
            const returns = [];
            
            for (let j = 1; j < periodData.length; j++) {
                const returnValue = (periodData[j].close - periodData[j-1].close) / periodData[j-1].close;
                returns.push(returnValue);
            }

            const avgReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
            const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
            volatilities.push(Math.sqrt(variance));
        }

        volatilities.sort((a, b) => a - b);
        const rank = volatilities.findIndex(v => v >= currentVolatility) / volatilities.length;

        if (rank < 0.2) return 'low';
        if (rank > 0.8) return 'high';
        return 'medium';
    }

    // Продвинутый анализ RSI
    analyzeRSIAdvanced(symbol, rsi) {
        const history = this.getPriceHistory(symbol);
        if (history.length < 30) return { signal: 'neutral', strength: 0, confidence: 0 };

        // RSI дивергенция
        const recentPrices = history.slice(-20).map(c => c.close);
        const recentRSI = this.calculateRSIHistory(symbol, 20);
        
        if (!recentRSI || recentRSI.length < 10) {
            return { signal: 'neutral', strength: 0, confidence: 0 };
        }

        let signal = 'neutral';
        let strength = 0;
        let confidence = 0;

        // Классические уровни RSI
        if (rsi < 25) {
            signal = 'bullish';
            strength = 1.2;
            confidence = 25;
        } else if (rsi > 75) {
            signal = 'bearish';
            strength = 1.2;
            confidence = 25;
        } else if (rsi < 35 && rsi > 30) {
            signal = 'bullish';
            strength = 0.8;
            confidence = 15;
        } else if (rsi > 65 && rsi < 70) {
            signal = 'bearish';
            strength = 0.8;
            confidence = 15;
        }

        // Проверка дивергенции
        const priceTrend = this.calculateTrend(recentPrices);
        const rsiTrend = this.calculateTrend(recentRSI);

        if (priceTrend < 0 && rsiTrend > 0 && rsi < 50) {
            // Бычья дивергенция
            signal = 'bullish';
            strength = Math.max(strength, 1.5);
            confidence += 20;
        } else if (priceTrend > 0 && rsiTrend < 0 && rsi > 50) {
            // Медвежья дивергенция
            signal = 'bearish';
            strength = Math.max(strength, 1.5);
            confidence += 20;
        }

        return { signal, strength, confidence };
    }

    // Продвинутый анализ MACD
    analyzeMACDAdvanced(symbol, macd) {
        const history = this.getPriceHistory(symbol);
        if (history.length < 30) return { signal: 'neutral', strength: 0, confidence: 0 };

        let signal = 'neutral';
        let strength = 0;
        let confidence = 0;

        // Анализ пересечения MACD и сигнальной линии
        if (macd.macd > macd.signal && macd.histogram > 0) {
            signal = 'bullish';
            strength = 1.0;
            confidence = 20;
            
            // Усиление сигнала при растущей гистограмме
            if (macd.histogram > 0.001) {
                strength = 1.3;
                confidence += 10;
            }
        } else if (macd.macd < macd.signal && macd.histogram < 0) {
            signal = 'bearish';
            strength = 1.0;
            confidence = 20;
            
            // Усиление сигнала при падающей гистограмме
            if (macd.histogram < -0.001) {
                strength = 1.3;
                confidence += 10;
            }
        }

        // Анализ дивергенции MACD
        const recentPrices = history.slice(-20).map(c => c.close);
        const recentMACD = this.calculateMACDHistory(symbol, 20);
        
        if (recentMACD && recentMACD.length >= 10) {
            const priceTrend = this.calculateTrend(recentPrices);
            const macdTrend = this.calculateTrend(recentMACD.map(m => m.macd));

            if (priceTrend < 0 && macdTrend > 0) {
                // Бычья дивергенция
                signal = 'bullish';
                strength = Math.max(strength, 1.4);
                confidence += 25;
            } else if (priceTrend > 0 && macdTrend < 0) {
                // Медвежья дивергенция
                signal = 'bearish';
                strength = Math.max(strength, 1.4);
                confidence += 25;
            }
        }

        return { signal, strength, confidence };
    }

    // Продвинутый анализ полос Боллинджера
    analyzeBollingerBandsAdvanced(currentPrice, bb) {
        let signal = 'neutral';
        let strength = 0;
        let confidence = 0;

        const bbWidth = (bb.upper - bb.lower) / bb.middle;
        const pricePosition = (currentPrice - bb.lower) / (bb.upper - bb.lower);

        // Отскок от нижней полосы
        if (currentPrice <= bb.lower * 1.001 && bbWidth > 0.02) {
            signal = 'bullish';
            strength = 1.1;
            confidence = 20;
        }
        // Отскок от верхней полосы
        else if (currentPrice >= bb.upper * 0.999 && bbWidth > 0.02) {
            signal = 'bearish';
            strength = 1.1;
            confidence = 20;
        }
        // Пробой с объемом
        else if (currentPrice > bb.upper && bbWidth < 0.015) {
            signal = 'bullish';
            strength = 1.3;
            confidence = 25;
        }
        else if (currentPrice < bb.lower && bbWidth < 0.015) {
            signal = 'bearish';
            strength = 1.3;
            confidence = 25;
        }

        return { signal, strength, confidence, bbWidth, pricePosition };
    }

    // Вспомогательные методы
    calculateRSIHistory(symbol, period) {
        const history = this.getPriceHistory(symbol);
        if (history.length < period + 14) return null;

        const closes = history.map(candle => candle.close);
        const rsi = RSI.calculate({ values: closes, period: 14 });
        return rsi.slice(-period);
    }

    calculateMACDHistory(symbol, period) {
        const history = this.getPriceHistory(symbol);
        if (history.length < period + 26) return null;

        const closes = history.map(candle => candle.close);
        const macd = MACD.calculate({
            values: closes,
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9
        });
        return macd.slice(-period);
    }

    calculateTrend(values) {
        if (values.length < 2) return 0;
        const first = values[0];
        const last = values[values.length - 1];
        return (last - first) / first;
    }

    // Комплексный анализ сигнала с высокой точностью и долгосрочным трендом
    analyzeSignal(symbol) {
        const rsi = this.calculateRSI(symbol);
        const macd = this.calculateMACD(symbol);
        const trend = this.analyzeTrend(symbol);
        const longTermTrend = this.analyzeLongTermTrend(symbol); // Новый долгосрочный анализ
        const bb = this.calculateBollingerBands(symbol);
        const currentPrice = this.getCurrentPrice(symbol);
        const volume = this.analyzeVolume(symbol);
        const volatility = this.calculateVolatility(symbol);

        if (!rsi || !macd || !currentPrice) {
            return { signal: 'neutral', strength: 0, details: {}, confidence: 0 };
        }

        let bullishSignals = 0;
        let bearishSignals = 0;
        let totalSignals = 0;
        let confidence = 0;
        const details = {};

        // 1. RSI анализ с дивергенцией
        const rsiAnalysis = this.analyzeRSIAdvanced(symbol, rsi);
        if (rsiAnalysis.signal === 'bullish') {
            bullishSignals += rsiAnalysis.strength;
            confidence += rsiAnalysis.confidence;
        } else if (rsiAnalysis.signal === 'bearish') {
            bearishSignals += rsiAnalysis.strength;
            confidence += rsiAnalysis.confidence;
        } else {
            // Нейтральный сигнал тоже учитываем для баланса
            confidence += 5; // Базовая уверенность
        }
        totalSignals++;
        details.rsi = rsiAnalysis;

        // 2. MACD анализ с гистограммой
        const macdAnalysis = this.analyzeMACDAdvanced(symbol, macd);
        if (macdAnalysis.signal === 'bullish') {
            bullishSignals += macdAnalysis.strength;
            confidence += macdAnalysis.confidence;
        } else if (macdAnalysis.signal === 'bearish') {
            bearishSignals += macdAnalysis.strength;
            confidence += macdAnalysis.confidence;
        } else {
            // Нейтральный сигнал тоже учитываем для баланса
            confidence += 5; // Базовая уверенность
        }
        totalSignals++;
        details.macd = macdAnalysis;

        // 3. Краткосрочный тренд анализ
        if (trend.trend === 'bullish') {
            bullishSignals += trend.strength * 1.0; // Снижаем вес краткосрочного тренда
            confidence += trend.strength * 15;
        } else if (trend.trend === 'bearish') {
            bearishSignals += trend.strength * 1.0;
            confidence += trend.strength * 15;
        } else {
            // Нейтральный тренд тоже учитываем
            confidence += 5; // Базовая уверенность
        }
        totalSignals++;
        details.trend = trend;

        // 4. ДОЛГОСРОЧНЫЙ ТРЕНД АНАЛИЗ - ГЛАВНЫЙ ФАКТОР
        if (longTermTrend.direction === 'bullish') {
            // Сильный долгосрочный бычий тренд - увеличиваем вес
            const trendWeight = this.getTrendWeight(longTermTrend);
            bullishSignals += trendWeight * 2.0; // Увеличиваем вес долгосрочного тренда
            confidence += longTermTrend.confidence * 0.8; // Высокий вес уверенности
            
            // Дополнительные бонусы за согласованность временных рамок
            if (longTermTrend.recommendation === 'strong_buy') {
                bullishSignals += 1.0;
                confidence += 20;
            } else if (longTermTrend.recommendation === 'moderate_buy') {
                bullishSignals += 0.5;
                confidence += 10;
            }
        } else if (longTermTrend.direction === 'bearish') {
            // Сильный долгосрочный медвежий тренд - увеличиваем вес
            const trendWeight = this.getTrendWeight(longTermTrend);
            bearishSignals += trendWeight * 2.0; // Увеличиваем вес долгосрочного тренда
            confidence += longTermTrend.confidence * 0.8; // Высокий вес уверенности
            
            // Дополнительные бонусы за согласованность временных рамок
            if (longTermTrend.recommendation === 'strong_sell') {
                bearishSignals += 1.0;
                confidence += 20;
            } else if (longTermTrend.recommendation === 'moderate_sell') {
                bearishSignals += 0.5;
                confidence += 10;
            }
        } else {
            // Нейтральный долгосрочный тренд
            confidence += 5; // Базовая уверенность
        }
        totalSignals++;
        details.longTermTrend = longTermTrend;

        // 5. Полосы Боллинджера с отскоками
        if (bb) {
            const bbAnalysis = this.analyzeBollingerBandsAdvanced(currentPrice, bb);
            if (bbAnalysis.signal === 'bullish') {
                bullishSignals += bbAnalysis.strength;
                confidence += bbAnalysis.confidence;
            } else if (bbAnalysis.signal === 'bearish') {
                bearishSignals += bbAnalysis.strength;
                confidence += bbAnalysis.confidence;
            } else {
                // Нейтральный сигнал BB тоже учитываем
                confidence += 5; // Базовая уверенность
            }
            totalSignals++;
            details.bb = bbAnalysis;
        }

        // 6. Анализ объемов
        if (volume) {
            if (volume.volumeConfirmation) {
                if (volume.obvTrend === 'bullish') {
                    bullishSignals += 0.8;
                    confidence += 15;
                } else if (volume.obvTrend === 'bearish') {
                    bearishSignals += 0.8;
                    confidence += 15;
                } else {
                    confidence += 8; // Частичное подтверждение объемом
                }
            } else {
                confidence += 3; // Базовая уверенность даже без подтверждения объемом
            }
            totalSignals++;
            details.volume = volume;
        }

        // 7. Анализ волатильности
        if (volatility) {
            if (volatility.volatilityRank === 'medium') {
                confidence += 10; // Средняя волатильность предпочтительна
            } else if (volatility.volatilityRank === 'low') {
                confidence += 5; // Низкая волатильность - меньше уверенности
            } else if (volatility.volatilityRank === 'high') {
                confidence += 3; // Высокая волатильность - осторожность
            }
        }

        // 8. ПРОВЕРКА СОГЛАСОВАННОСТИ С ДОЛГОСРОЧНЫМ ТРЕНДОМ
        const trendAlignment = this.checkTrendAlignment(longTermTrend, rsiAnalysis, macdAnalysis);
        if (trendAlignment.aligned) {
            // Если краткосрочные сигналы согласованы с долгосрочным трендом - усиливаем
            if (trendAlignment.direction === 'bullish') {
                bullishSignals += 0.5;
                confidence += 15;
            } else if (trendAlignment.direction === 'bearish') {
                bearishSignals += 0.5;
                confidence += 15;
            }
        } else {
            // Если краткосрочные сигналы противоречат долгосрочному тренду - снижаем уверенность
            confidence *= 0.7; // Снижаем общую уверенность
        }
        details.trendAlignment = trendAlignment;

        // Финальный расчет
        const signalStrength = totalSignals > 0 ? Math.abs(bullishSignals - bearishSignals) / totalSignals : 0;
        const finalConfidence = Math.min(confidence, 100);
        
        let signal = 'neutral';
        let finalSignal = 'neutral';
        
        // Определяем базовый сигнал
        if (bullishSignals > bearishSignals && signalStrength > 0.4 && finalConfidence > 30) {
            signal = 'buy';
        } else if (bearishSignals > bullishSignals && signalStrength > 0.4 && finalConfidence > 30) {
            signal = 'sell';
        }

        // ФИНАЛЬНАЯ ПРОВЕРКА: учитываем долгосрочный тренд для финального решения
        if (longTermTrend.direction !== 'neutral' && longTermTrend.confidence > 50) {
            // Если долгосрочный тренд сильный, он имеет приоритет
            if (longTermTrend.direction === 'bullish' && signal === 'buy') {
                finalSignal = 'buy'; // Подтверждаем покупку
            } else if (longTermTrend.direction === 'bearish' && signal === 'sell') {
                finalSignal = 'sell'; // Подтверждаем продажу
            } else if (longTermTrend.direction === 'bullish' && signal === 'sell') {
                finalSignal = 'neutral'; // Противоречие - не торгуем
            } else if (longTermTrend.direction === 'bearish' && signal === 'buy') {
                finalSignal = 'neutral'; // Противоречие - не торгуем
            } else {
                finalSignal = signal; // Используем базовый сигнал
            }
        } else {
            finalSignal = signal; // Используем базовый сигнал
        }

        return {
            signal: finalSignal,
            strength: signalStrength,
            confidence: finalConfidence,
            details: {
                ...details,
                rsi_value: rsi,
                macd_value: macd,
                trend_strength: trend.strength,
                current_price: currentPrice,
                volatility: volatility,
                long_term_trend_direction: longTermTrend.direction,
                long_term_trend_confidence: longTermTrend.confidence,
                long_term_trend_recommendation: longTermTrend.recommendation
            }
        };
    }

    // Получение веса тренда на основе его силы и уверенности
    getTrendWeight(longTermTrend) {
        const { strength, confidence } = longTermTrend;
        return Math.min(strength * (confidence / 100), 1.0);
    }

    // Проверка согласованности краткосрочных сигналов с долгосрочным трендом
    checkTrendAlignment(longTermTrend, rsiAnalysis, macdAnalysis) {
        if (longTermTrend.direction === 'neutral') {
            return { aligned: false, direction: 'neutral', score: 0 };
        }

        let alignmentScore = 0;
        let totalChecks = 0;

        // Проверяем RSI
        if (rsiAnalysis.signal !== 'neutral') {
            totalChecks++;
            if ((longTermTrend.direction === 'bullish' && rsiAnalysis.signal === 'bullish') ||
                (longTermTrend.direction === 'bearish' && rsiAnalysis.signal === 'bearish')) {
                alignmentScore++;
            }
        }

        // Проверяем MACD
        if (macdAnalysis.signal !== 'neutral') {
            totalChecks++;
            if ((longTermTrend.direction === 'bullish' && macdAnalysis.signal === 'bullish') ||
                (longTermTrend.direction === 'bearish' && macdAnalysis.signal === 'bearish')) {
                alignmentScore++;
            }
        }

        const alignmentRatio = totalChecks > 0 ? alignmentScore / totalChecks : 0;
        const aligned = alignmentRatio >= 0.5; // Согласованность если >= 50%

        return {
            aligned,
            direction: longTermTrend.direction,
            score: alignmentRatio,
            details: {
                rsiAligned: rsiAnalysis.signal === longTermTrend.direction || rsiAnalysis.signal === 'neutral',
                macdAligned: macdAnalysis.signal === longTermTrend.direction || macdAnalysis.signal === 'neutral',
                alignmentRatio: alignmentRatio
            }
        };
    }

    // Проверка объема
    checkVolume(symbol, minVolume = 1000) {
        const history = this.getPriceHistory(symbol);
        if (history.length < 5) return false;

        const recentVolumes = history.slice(-5).map(candle => candle.volume);
        const avgVolume = recentVolumes.reduce((sum, vol) => sum + vol, 0) / recentVolumes.length;
        
        return avgVolume >= minVolume;
    }

    // Подтверждение сигнала (проверка на ложные сигналы)
    confirmSignal(symbol, signal, confirmations = 2) {
        const history = this.getPriceHistory(symbol);
        if (history.length < confirmations + 1) return false;

        let confirmCount = 0;
        for (let i = 1; i <= confirmations; i++) {
            const prevCandle = history[history.length - 1 - i];
            const currentCandle = history[history.length - i];
            
            if (signal === 'buy' && currentCandle.close > prevCandle.close) {
                confirmCount++;
            } else if (signal === 'sell' && currentCandle.close < prevCandle.close) {
                confirmCount++;
            }
        }

        return confirmCount >= confirmations;
    }
}

module.exports = TechnicalAnalysis;
