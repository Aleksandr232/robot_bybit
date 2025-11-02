const winston = require('winston');

class PerformanceMonitor {
    constructor() {
        // Функция для получения московского времени
        this.getMoscowTime = () => {
            const now = new Date();
            const moscowTime = new Date(now.getTime() + (3 * 60 * 60 * 1000)); // UTC+3
            return moscowTime.toLocaleString('ru-RU', {
                timeZone: 'Europe/Moscow',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
        };

        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp({
                    format: () => this.getMoscowTime()
                }),
                winston.format.json()
            ),
            transports: [
                new winston.transports.File({ filename: 'performance.log' }),
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.colorize(),
                        winston.format.printf(({ level, message, timestamp, ...meta }) => {
                            return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''}`;
                        })
                    )
                })
            ]
        });

        this.metrics = {
            signalsAnalyzed: 0,
            signalsFiltered: 0,
            tradesExecuted: 0,
            tradesSuccessful: 0,
            totalProfit: 0,
            totalLoss: 0,
            startTime: Date.now()
        };

        this.signalHistory = [];
        this.tradeHistory = [];
    }

    // Запись анализа сигнала
    recordSignalAnalysis(symbol, signal, filtered) {
        this.metrics.signalsAnalyzed++;
        
        if (filtered) {
            this.metrics.signalsFiltered++;
        }

        const signalRecord = {
            timestamp: Date.now(),
            moscowTime: this.getMoscowTime(),
            symbol,
            signal: signal.signal,
            strength: signal.strength,
            confidence: signal.confidence,
            filtered,
            details: signal.details
        };

        this.signalHistory.push(signalRecord);

        // Логирование только важных сигналов
        if (signal.strength > 0.7 || signal.confidence > 70) {
            this.logger.info('📊 Анализ сигнала', {
                moscowTime: this.getMoscowTime(),
                symbol,
                signal: signal.signal,
                strength: signal.strength.toFixed(3),
                confidence: signal.confidence.toFixed(1),
                filtered: filtered ? 'ДА' : 'НЕТ',
                rsi: signal.details.rsi_value?.toFixed(1),
                macd: signal.details.macd_value?.macd?.toFixed(4),
                trend: signal.details.trend?.trend,
                volume: signal.details.volume?.volumeRatio?.toFixed(2)
            });
        }
    }

    // Запись выполненной сделки
    recordTrade(symbol, side, size, price, stopLoss, takeProfit, signal) {
        this.metrics.tradesExecuted++;

        const tradeRecord = {
            timestamp: Date.now(),
            moscowTime: this.getMoscowTime(),
            symbol,
            side,
            size,
            entryPrice: price,
            stopLoss,
            takeProfit,
            signalStrength: signal.strength,
            signalConfidence: signal.confidence,
            status: 'open'
        };

        this.tradeHistory.push(tradeRecord);

        this.logger.info('💰 Выполнена сделка', {
            moscowTime: this.getMoscowTime(),
            symbol,
            side,
            size: size.toFixed(2),
            price: price.toFixed(4),
            stopLoss: stopLoss.toFixed(4),
            takeProfit: takeProfit.toFixed(4),
            signalStrength: signal.strength.toFixed(3),
            signalConfidence: signal.confidence.toFixed(1)
        });
    }

    // Запись закрытия сделки
    recordTradeClose(symbol, exitPrice, pnl, reason) {
        const trade = this.tradeHistory.find(t => t.symbol === symbol && t.status === 'open');
        if (!trade) return;

        trade.exitPrice = exitPrice;
        trade.pnl = pnl;
        trade.exitTime = Date.now();
        trade.exitMoscowTime = this.getMoscowTime();
        trade.status = 'closed';
        trade.closeReason = reason;

        if (pnl > 0) {
            this.metrics.tradesSuccessful++;
            this.metrics.totalProfit += pnl;
        } else {
            this.metrics.totalLoss += Math.abs(pnl);
        }

        this.logger.info('🔒 Закрыта сделка', {
            moscowTime: this.getMoscowTime(),
            symbol,
            exitPrice: exitPrice.toFixed(4),
            pnl: pnl.toFixed(2),
            reason,
            duration: ((trade.exitTime - trade.timestamp) / 1000 / 60).toFixed(1) + ' мин'
        });
    }

    // Получение статистики производительности
    getPerformanceStats() {
        const uptime = Date.now() - this.metrics.startTime;
        const winRate = this.metrics.tradesExecuted > 0 
            ? (this.metrics.tradesSuccessful / this.metrics.tradesExecuted * 100).toFixed(1)
            : 0;

        const avgProfit = this.metrics.tradesSuccessful > 0 
            ? (this.metrics.totalProfit / this.metrics.tradesSuccessful).toFixed(2)
            : 0;

        const avgLoss = (this.metrics.tradesExecuted - this.metrics.tradesSuccessful) > 0
            ? (this.metrics.totalLoss / (this.metrics.tradesExecuted - this.metrics.tradesSuccessful)).toFixed(2)
            : 0;

        const profitFactor = this.metrics.totalLoss > 0 
            ? (this.metrics.totalProfit / this.metrics.totalLoss).toFixed(2)
            : 0;

        const signalFilterRate = this.metrics.signalsAnalyzed > 0
            ? (this.metrics.signalsFiltered / this.metrics.signalsAnalyzed * 100).toFixed(1)
            : 0;

        return {
            uptime: Math.floor(uptime / 1000 / 60), // в минутах
            signalsAnalyzed: this.metrics.signalsAnalyzed,
            signalsFiltered: this.metrics.signalsFiltered,
            signalFilterRate: signalFilterRate + '%',
            tradesExecuted: this.metrics.tradesExecuted,
            tradesSuccessful: this.metrics.tradesSuccessful,
            winRate: winRate + '%',
            totalProfit: this.metrics.totalProfit.toFixed(2),
            totalLoss: this.metrics.totalLoss.toFixed(2),
            netProfit: (this.metrics.totalProfit - this.metrics.totalLoss).toFixed(2),
            avgProfit: avgProfit,
            avgLoss: avgLoss,
            profitFactor: profitFactor
        };
    }

    // Анализ качества сигналов
    analyzeSignalQuality() {
        const recentSignals = this.signalHistory.slice(-100); // Последние 100 сигналов
        
        if (recentSignals.length === 0) {
            return { message: 'Недостаточно данных для анализа' };
        }

        const strongSignals = recentSignals.filter(s => s.strength > 0.7);
        const highConfidenceSignals = recentSignals.filter(s => s.confidence > 70);
        const filteredSignals = recentSignals.filter(s => s.filtered);

        const avgStrength = recentSignals.reduce((sum, s) => sum + s.strength, 0) / recentSignals.length;
        const avgConfidence = recentSignals.reduce((sum, s) => sum + s.confidence, 0) / recentSignals.length;

        return {
            totalSignals: recentSignals.length,
            strongSignals: strongSignals.length,
            highConfidenceSignals: highConfidenceSignals.length,
            filteredSignals: filteredSignals.length,
            avgStrength: avgStrength.toFixed(3),
            avgConfidence: avgConfidence.toFixed(1),
            filterEfficiency: (filteredSignals.length / recentSignals.length * 100).toFixed(1) + '%'
        };
    }

    // Рекомендации по оптимизации
    getOptimizationRecommendations() {
        const stats = this.getPerformanceStats();
        const signalQuality = this.analyzeSignalQuality();
        const recommendations = [];

        // Анализ прибыльности
        if (parseFloat(stats.winRate) < 70) {
            recommendations.push({
                type: 'profitability',
                priority: 'high',
                message: 'Прибыльность ниже целевой 70-80%. Рекомендуется ужесточить фильтры сигналов.',
                action: 'Увеличить minSignalStrength до 0.8 и minConfidence до 70'
            });
        }

        // Анализ фильтрации
        if (parseFloat(signalQuality.filterEfficiency) < 60) {
            recommendations.push({
                type: 'filtering',
                priority: 'medium',
                message: 'Низкая эффективность фильтрации сигналов.',
                action: 'Добавить дополнительные фильтры или увеличить строгость существующих'
            });
        }

        // Анализ силы сигналов
        if (parseFloat(signalQuality.avgStrength) < 0.6) {
            recommendations.push({
                type: 'signal_quality',
                priority: 'medium',
                message: 'Средняя сила сигналов низкая.',
                action: 'Проверить настройки технических индикаторов'
            });
        }

        // Анализ уверенности
        if (parseFloat(signalQuality.avgConfidence) < 60) {
            recommendations.push({
                type: 'confidence',
                priority: 'high',
                message: 'Низкая средняя уверенность в сигналах.',
                action: 'Требовать больше подтверждающих индикаторов'
            });
        }

        return recommendations;
    }

    // Ежедневный отчет
    generateDailyReport() {
        const stats = this.getPerformanceStats();
        const signalQuality = this.analyzeSignalQuality();
        const recommendations = this.getOptimizationRecommendations();

        this.logger.info('📈 ЕЖЕДНЕВНЫЙ ОТЧЕТ', {
            moscowTime: this.getMoscowTime(),
            performance: stats,
            signalQuality: signalQuality,
            recommendations: recommendations.length,
            topRecommendation: recommendations[0]?.message || 'Все показатели в норме'
        });

        return {
            date: new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }),
            moscowTime: this.getMoscowTime(),
            stats,
            signalQuality,
            recommendations
        };
    }
}

module.exports = PerformanceMonitor;