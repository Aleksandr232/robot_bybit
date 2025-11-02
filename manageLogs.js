const LogManager = require('./logManager');

// Простой скрипт для управления логами
async function main() {
    const logManager = new LogManager();
    
    console.log('🗂️ Менеджер логов торгового бота');
    console.log('=====================================');
    
    try {
        // Получаем информацию о логах
        console.log('\n📊 Информация о логах:');
        const logInfo = await logManager.getLogInfo();
        
        for (const [fileName, info] of Object.entries(logInfo)) {
            if (info.exists) {
                console.log(`📄 ${fileName}: ${info.sizeMB} MB (${info.needsCleanup ? 'требует очистки' : 'OK'})`);
            } else {
                console.log(`📄 ${fileName}: не существует`);
            }
        }
        
        // Получаем статистику
        console.log('\n📈 Статистика логов:');
        const stats = await logManager.getLogStats();
        console.log(`📁 Всего файлов: ${stats.totalFiles}`);
        console.log(`📄 Существующих: ${stats.existingFiles}`);
        console.log(`💾 Общий размер: ${stats.totalSizeMB} MB`);
        console.log(`⚠️ Требуют очистки: ${stats.filesNeedingCleanup}`);
        console.log(`🕐 Следующая очистка: ${stats.nextCleanup}`);
        
        // Спрашиваем пользователя
        console.log('\n🔧 Доступные действия:');
        console.log('1. Ручная очистка логов');
        console.log('2. Очистка старых архивов');
        console.log('3. Запуск автоматической очистки');
        console.log('4. Выход');
        
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        rl.question('\nВыберите действие (1-4): ', async (answer) => {
            switch (answer.trim()) {
                case '1':
                    console.log('\n🗂️ Выполняем ручную очистку логов...');
                    await logManager.manualCleanup();
                    break;
                    
                case '2':
                    console.log('\n🗑️ Очищаем старые архивы...');
                    await logManager.cleanupOldArchives();
                    break;
                    
                case '3':
                    console.log('\n🔄 Запускаем автоматическую очистку...');
                    logManager.startAutoCleanup();
                    console.log('✅ Автоматическая очистка запущена (каждые 5 часов)');
                    console.log('Нажмите Ctrl+C для остановки');
                    break;
                    
                case '4':
                    console.log('\n👋 До свидания!');
                    rl.close();
                    process.exit(0);
                    break;
                    
                default:
                    console.log('\n❌ Неверный выбор');
                    rl.close();
                    process.exit(1);
            }
            
            rl.close();
            process.exit(0);
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
        process.exit(1);
    }
}

// Обработка завершения
process.on('SIGINT', () => {
    console.log('\n👋 До свидания!');
    process.exit(0);
});

// Запуск
main();
