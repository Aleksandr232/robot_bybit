const TradingBot = require('./tradingBot');
const winston = require('winston');

// Настройка логирования для мониторинга
const monitorLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'bot-monitor.log' }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

class BotMonitor {
    constructor() {
        this.bot = null;
        this.monitorInterval = null;
        this.statusCheckInterval = 30000; // Проверка каждые 30 секунд
    }

    // Запуск мониторинга
    start() {
        monitorLogger.info('🔍 Запуск мониторинга бота...');
        
        // Создаем экземпляр бота
        this.bot = new TradingBot();
        
        // Запускаем бота
        this.bot.start().catch(error => {
            monitorLogger.error('❌ Ошибка запуска бота:', error);
        });

        // Запускаем мониторинг
        this.startMonitoring();
    }

    // Запуск мониторинга состояния
    startMonitoring() {
        this.monitorInterval = setInterval(() => {
            this.checkBotStatus();
        }, this.statusCheckInterval);

        monitorLogger.info('✅ Мониторинг бота запущен');
    }

    // Проверка состояния бота
    async checkBotStatus() {
        if (!this.bot) {
            monitorLogger.warn('⚠️ Бот не инициализирован');
            return;
        }

        try {
            const status = await this.bot.getBotStatus();
            
            // Логируем статус каждые 5 минут
            if (Date.now() % (5 * 60 * 1000) < this.statusCheckInterval) {
                monitorLogger.info('📊 Статус бота:', {
                    isRunning: status.isRunning,
                    uptime: status.uptime + ' мин',
                    balance: status.balance.toFixed(2) + ' USDT',
                    openPositions: status.openPositions,
                    wsConnected: status.wsConnection.isConnected,
                    timeSinceLastData: Math.round(status.wsConnection.timeSinceLastData / 1000) + ' сек',
                    timeToNextRestart: status.autoRestart.timeToNextRestart + ' мин',
                    logFiles: status.logs.totalFiles,
                    logSize: status.logs.totalSizeMB + ' MB',
                    logsNeedingCleanup: status.logs.filesNeedingCleanup
                });
            }

            // Проверяем критические состояния
            this.checkCriticalStates(status);

        } catch (error) {
            monitorLogger.error('❌ Ошибка проверки статуса бота:', error);
        }
    }

    // Проверка критических состояний
    checkCriticalStates(status) {
        // Проверяем WebSocket соединение
        if (!status.wsConnection.isConnected) {
            monitorLogger.warn('⚠️ WebSocket соединение разорвано');
        }

        // Проверяем отсутствие данных
        if (status.wsConnection.timeSinceLastData > 600000) { // 10 минут
            monitorLogger.error('🚨 КРИТИЧНО: Нет данных от WebSocket более 10 минут!');
        }

        // Проверяем баланс
        if (status.balance < 50) {
            monitorLogger.warn('⚠️ Низкий баланс:', status.balance + ' USDT');
        }

        // Проверяем количество открытых позиций
        if (status.openPositions > 20) {
            monitorLogger.warn('⚠️ Много открытых позиций:', status.openPositions);
        }

        // Проверяем размер логов
        if (parseFloat(status.logs.totalSizeMB) > 100) { // 100MB
            monitorLogger.warn('⚠️ Большой размер логов:', status.logs.totalSizeMB + ' MB');
        }

        // Проверяем файлы, требующие очистки
        if (status.logs.filesNeedingCleanup > 0) {
            monitorLogger.warn('⚠️ Файлы логов требуют очистки:', status.logs.filesNeedingCleanup);
        }
    }

    // Остановка мониторинга
    stop() {
        monitorLogger.info('🛑 Остановка мониторинга...');
        
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
        }

        if (this.bot) {
            this.bot.stop();
        }

        monitorLogger.info('✅ Мониторинг остановлен');
    }

    // Ручной перезапуск бота
    async manualRestart() {
        monitorLogger.info('🔄 Ручной перезапуск бота...');
        
        if (this.bot) {
            await this.bot.manualRestart();
        }
    }

    // Получение детального статуса
    async getDetailedStatus() {
        if (!this.bot) return null;
        return await this.bot.getBotStatus();
    }

    // Ручная очистка логов
    async manualLogCleanup() {
        monitorLogger.info('🗂️ Ручная очистка логов...');
        if (this.bot) {
            await this.bot.manualLogCleanup();
        }
    }

    // Получение информации о логах
    async getLogInfo() {
        if (!this.bot) return null;
        return await this.bot.getLogInfo();
    }
}

// Запуск мониторинга
if (require.main === module) {
    const monitor = new BotMonitor();
    
    // Обработка сигналов завершения
    process.on('SIGINT', async () => {
        console.log('\n🛑 Остановка мониторинга...');
        monitor.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\n🛑 Остановка мониторинга...');
        monitor.stop();
        process.exit(0);
    });

    // Запуск
    monitor.start();
}

module.exports = BotMonitor;
