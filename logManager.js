const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');

class LogManager {
    constructor() {
        this.logFiles = [
            'trading-bot.log',
            'bot-monitor.log',
            'performance.log',
            'test-mode.log'
        ];
        
        this.archiveDir = 'logs-archive';
        this.cleanupInterval = null;
        this.cleanupIntervalMs = 5 * 60 * 60 * 1000; // 5 часов
        
        // Настройка логирования для LogManager
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                new winston.transports.File({ filename: 'log-manager.log' }),
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.colorize(),
                        winston.format.simple()
                    )
                })
            ]
        });
    }

    // Запуск автоматической очистки логов
    startAutoCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        this.cleanupInterval = setInterval(() => {
            this.performLogCleanup();
        }, this.cleanupIntervalMs);

        const nextCleanupTime = new Date(Date.now() + this.cleanupIntervalMs);
        this.logger.info(`🗂️ Автоматическая очистка логов настроена (каждые 5 часов). Следующая очистка: ${nextCleanupTime.toLocaleString('ru-RU')}`);
    }

    // Остановка автоматической очистки
    stopAutoCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
            this.logger.info('🛑 Автоматическая очистка логов отключена');
        }
    }

    // Выполнение очистки логов
    async performLogCleanup() {
        try {
            this.logger.info('🗂️ ВЫПОЛНЯЕМ ОЧИСТКУ ЛОГОВ...');
            
            // Создаем директорию для архивов если её нет
            await this.ensureArchiveDirectory();
            
            // Обрабатываем каждый лог файл
            for (const logFile of this.logFiles) {
                await this.processLogFile(logFile);
            }
            
            this.logger.info('✅ Очистка логов завершена успешно');
            
        } catch (error) {
            this.logger.error('❌ Ошибка при очистке логов:', error);
        }
    }

    // Обработка отдельного лог файла
    async processLogFile(logFile) {
        try {
            const filePath = path.join(process.cwd(), logFile);
            
            // Проверяем существование файла
            try {
                await fs.access(filePath);
            } catch (error) {
                this.logger.info(`📄 Лог файл ${logFile} не существует, пропускаем`);
                return;
            }

            // Получаем информацию о файле
            const stats = await fs.stat(filePath);
            const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
            
            this.logger.info(`📄 Обрабатываем ${logFile}: ${fileSizeMB} MB`);

            // Если файл больше 50MB, архивируем и очищаем
            if (stats.size > 50 * 1024 * 1024) { // 50MB
                await this.archiveAndClearLog(logFile, filePath);
            } else {
                // Если файл меньше 50MB, просто архивируем последние записи
                await this.archiveRecentLogs(logFile, filePath);
            }

        } catch (error) {
            this.logger.error(`❌ Ошибка обработки ${logFile}:`, error);
        }
    }

    // Архивирование и очистка большого лог файла
    async archiveAndClearLog(logFile, filePath) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const archiveFileName = `${logFile.replace('.log', '')}-${timestamp}.log`;
            const archivePath = path.join(this.archiveDir, archiveFileName);

            // Читаем содержимое файла
            const content = await fs.readFile(filePath, 'utf8');
            
            // Сохраняем в архив
            await fs.writeFile(archivePath, content, 'utf8');
            
            // Очищаем оригинальный файл
            await fs.writeFile(filePath, '', 'utf8');
            
            this.logger.info(`📦 Архивирован и очищен: ${logFile} -> ${archiveFileName}`);
            
        } catch (error) {
            this.logger.error(`❌ Ошибка архивирования ${logFile}:`, error);
        }
    }

    // Архивирование последних записей из лог файла
    async archiveRecentLogs(logFile, filePath) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const archiveFileName = `${logFile.replace('.log', '')}-${timestamp}.log`;
            const archivePath = path.join(this.archiveDir, archiveFileName);

            // Читаем содержимое файла
            const content = await fs.readFile(filePath, 'utf8');
            const lines = content.split('\n');
            
            // Берем последние 1000 строк
            const recentLines = lines.slice(-1000);
            const recentContent = recentLines.join('\n');
            
            // Сохраняем в архив
            await fs.writeFile(archivePath, recentContent, 'utf8');
            
            // Очищаем оригинальный файл
            await fs.writeFile(filePath, '', 'utf8');
            
            this.logger.info(`📦 Архивированы последние записи: ${logFile} -> ${archiveFileName}`);
            
        } catch (error) {
            this.logger.error(`❌ Ошибка архивирования последних записей ${logFile}:`, error);
        }
    }

    // Создание директории для архивов
    async ensureArchiveDirectory() {
        try {
            await fs.mkdir(this.archiveDir, { recursive: true });
            this.logger.info(`📁 Директория архивов: ${this.archiveDir}`);
        } catch (error) {
            this.logger.error('❌ Ошибка создания директории архивов:', error);
        }
    }

    // Ручная очистка логов
    async manualCleanup() {
        this.logger.info('🗂️ РУЧНАЯ ОЧИСТКА ЛОГОВ...');
        await this.performLogCleanup();
    }

    // Получение информации о логах
    async getLogInfo() {
        const logInfo = {};
        
        for (const logFile of this.logFiles) {
            try {
                const filePath = path.join(process.cwd(), logFile);
                const stats = await fs.stat(filePath);
                
                logInfo[logFile] = {
                    exists: true,
                    size: stats.size,
                    sizeMB: (stats.size / 1024 / 1024).toFixed(2),
                    lastModified: stats.mtime,
                    needsCleanup: stats.size > 50 * 1024 * 1024 // 50MB
                };
            } catch (error) {
                logInfo[logFile] = {
                    exists: false,
                    error: error.message
                };
            }
        }
        
        return logInfo;
    }

    // Очистка старых архивов (старше 30 дней)
    async cleanupOldArchives() {
        try {
            const archivePath = path.join(process.cwd(), this.archiveDir);
            
            try {
                await fs.access(archivePath);
            } catch (error) {
                this.logger.info('📁 Директория архивов не существует');
                return;
            }

            const files = await fs.readdir(archivePath);
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            let deletedCount = 0;

            for (const file of files) {
                const filePath = path.join(archivePath, file);
                const stats = await fs.stat(filePath);
                
                if (stats.mtime.getTime() < thirtyDaysAgo) {
                    await fs.unlink(filePath);
                    deletedCount++;
                    this.logger.info(`🗑️ Удален старый архив: ${file}`);
                }
            }

            if (deletedCount > 0) {
                this.logger.info(`🗑️ Удалено ${deletedCount} старых архивов`);
            } else {
                this.logger.info('📁 Старых архивов для удаления не найдено');
            }

        } catch (error) {
            this.logger.error('❌ Ошибка очистки старых архивов:', error);
        }
    }

    // Получение статистики логов
    async getLogStats() {
        const logInfo = await this.getLogInfo();
        const totalSize = Object.values(logInfo)
            .filter(info => info.exists)
            .reduce((sum, info) => sum + info.size, 0);

        return {
            totalFiles: this.logFiles.length,
            existingFiles: Object.values(logInfo).filter(info => info.exists).length,
            totalSize: totalSize,
            totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
            filesNeedingCleanup: Object.values(logInfo).filter(info => info.needsCleanup).length,
            nextCleanup: this.cleanupInterval ? new Date(Date.now() + this.cleanupIntervalMs).toLocaleString('ru-RU') : 'Отключено',
            logFiles: logInfo
        };
    }
}

module.exports = LogManager;
