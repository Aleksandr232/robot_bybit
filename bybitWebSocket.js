const WebSocket = require('ws');
const crypto = require('crypto');
const axios = require('axios');

class BybitWebSocket {
    constructor(config) {
        this.testnet = config.testnet || false;
        
        // Настройка URL для получения kline данных (только публичный канал)
        // Для получения реальных данных используем mainnet
        this.baseUrl = 'wss://stream.bybit.com/v5/public/linear';
       
        
        this.publicWs = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10; // Увеличиваем количество попыток
        this.reconnectDelay = 1000;
        this.isConnected = false;
        this.lastDataReceived = Date.now();
        this.connectionCheckInterval = null;
        this.subscribedSymbols = [];
        this.subscribedInterval = null;
        
        // Настройки мониторинга соединения
        this.dataTimeout = 300000; // 5 минут без данных = проблема
        this.connectionCheckInterval = 60000; // Проверка каждую минуту
    }

    // Подключение к публичному каналу для получения kline данных
    connectPublic() {
        return new Promise((resolve, reject) => {
            if (!this.baseUrl) {
                console.log('📊 Публичный канал не настроен');
                resolve();
                return;
            }

            console.log(`🔄 Подключение к WebSocket: ${this.baseUrl}`);
            this.publicWs = new WebSocket(this.baseUrl);
            
            this.publicWs.on('open', () => {
                console.log('✅ Подключение к публичному каналу Bybit установлено');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.lastDataReceived = Date.now();
                
                // Запускаем мониторинг соединения
                this.startConnectionMonitoring();
                
                resolve();
            });

            this.publicWs.on('message', (data) => {
                try {
                    this.lastDataReceived = Date.now(); // Обновляем время получения данных
                    const message = JSON.parse(data.toString());
                    this.handlePublicMessage(message);
                } catch (error) {
                    console.error('Ошибка парсинга публичного сообщения:', error);
                }
            });

            this.publicWs.on('error', (error) => {
                console.error('❌ Ошибка публичного WebSocket:', error);
                this.isConnected = false;
                reject(error);
            });

            this.publicWs.on('close', (code, reason) => {
                console.log(`❌ Публичное WebSocket соединение закрыто. Код: ${code}, Причина: ${reason}`);
                this.isConnected = false;
                this.stopConnectionMonitoring();
                this.reconnectPublic();
            });

            // Таймаут подключения
            setTimeout(() => {
                if (!this.isConnected) {
                    console.error('⏰ Таймаут подключения к WebSocket');
                    this.publicWs.terminate();
                    reject(new Error('WebSocket connection timeout'));
                }
            }, 10000); // 10 секунд таймаут
        });
    }



    // Подписка на kline данные
    subscribeKline(symbol, interval) {
        if (!this.publicWs) {
            console.log(`📊 Публичный WebSocket не подключен, пропускаем подписку на ${symbol}`);
            return;
        }

        const subscribeMessage = {
            op: "subscribe",
            args: [`kline.${interval}.${symbol}`]
        };

        console.log(`📊 Отправляем подписку:`, JSON.stringify(subscribeMessage, null, 2));
        this.publicWs.send(JSON.stringify(subscribeMessage));
        console.log(`📊 Подписка на kline данные: ${symbol} (${interval}м)`);
    }

    // Подписка на несколько символов одновременно
    subscribeMultipleKlines(symbols, interval) {
        if (!this.publicWs || !this.isConnected) {
            console.log(`📊 Публичный WebSocket не подключен, пропускаем подписку`);
            return;
        }

        // Сохраняем информацию о подписках для переподключения
        this.subscribedSymbols = symbols;
        this.subscribedInterval = interval;

        const args = symbols.map(symbol => `kline.${interval}.${symbol}`);
        const subscribeMessage = {
            op: "subscribe",
            args: args
        };

        console.log(`📊 Отправляем множественную подписку:`, JSON.stringify(subscribeMessage, null, 2));
        this.publicWs.send(JSON.stringify(subscribeMessage));
        console.log(`📊 Подписка на kline данные для: ${symbols.join(', ')} (${interval}м)`);
    }

    // Мониторинг соединения
    startConnectionMonitoring() {
        if (this.connectionCheckInterval) {
            clearInterval(this.connectionCheckInterval);
        }

        this.connectionCheckInterval = setInterval(() => {
            this.checkConnectionHealth();
        }, this.connectionCheckInterval);
    }

    // Остановка мониторинга соединения
    stopConnectionMonitoring() {
        if (this.connectionCheckInterval) {
            clearInterval(this.connectionCheckInterval);
            this.connectionCheckInterval = null;
        }
    }

    // Проверка здоровья соединения
    checkConnectionHealth() {
        const now = Date.now();
        const timeSinceLastData = now - this.lastDataReceived;

        console.log(`🔍 Проверка WebSocket соединения:`, {
            isConnected: this.isConnected,
            timeSinceLastData: Math.round(timeSinceLastData / 1000) + ' сек',
            reconnectAttempts: this.reconnectAttempts
        });

        // Если нет данных более 5 минут, переподключаемся
        if (timeSinceLastData > this.dataTimeout) {
            console.warn(`⚠️ Нет данных от WebSocket ${Math.round(timeSinceLastData / 1000)} секунд. Переподключаемся...`);
            this.forceReconnect();
        }

        // Проверяем состояние соединения
        if (this.publicWs && this.publicWs.readyState !== WebSocket.OPEN) {
            console.warn(`⚠️ WebSocket не в состоянии OPEN. Текущее состояние: ${this.publicWs.readyState}`);
            this.forceReconnect();
        }
    }

    // Принудительное переподключение
    forceReconnect() {
        console.log('🔄 Принудительное переподключение WebSocket...');
        this.isConnected = false;
        this.stopConnectionMonitoring();
        
        if (this.publicWs) {
            this.publicWs.terminate();
        }
        
        this.reconnectPublic();
    }


    // Обработка публичных сообщений
    handlePublicMessage(message) {
        console.log('📡 Получено публичное сообщение:', JSON.stringify(message, null, 2));
        
        // Обработка ответов на подписку
        if (message.op === 'subscribe') {
            if (message.success) {
                console.log('✅ Подписка успешна:', message.conn_id);
            } else {
                console.error('❌ Ошибка подписки:', message.ret_msg);
            }
            return;
        }
        
        // Обработка kline данных
        if (message.topic && message.topic.includes('kline')) {
            this.onKlineData(message);
        }
    }


    // Переподключение публичного канала
    reconnectPublic() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(this.reconnectDelay * this.reconnectAttempts, 30000); // Максимум 30 секунд
            
            console.log(`🔄 Попытка переподключения публичного канала (${this.reconnectAttempts}/${this.maxReconnectAttempts}) через ${delay/1000} сек`);
            
            setTimeout(async () => {
                try {
                    await this.connectPublic();
                    
                    // После успешного переподключения восстанавливаем подписки
                    if (this.subscribedSymbols.length > 0 && this.subscribedInterval) {
                        console.log('🔄 Восстанавливаем подписки после переподключения...');
                        setTimeout(() => {
                            this.subscribeMultipleKlines(this.subscribedSymbols, this.subscribedInterval);
                        }, 2000); // Ждем 2 секунды перед восстановлением подписок
                    }
                } catch (error) {
                    console.error('❌ Ошибка переподключения:', error);
                }
            }, delay);
        } else {
            console.error('❌ Превышено максимальное количество попыток переподключения публичного канала');
            console.log('🔄 Сбрасываем счетчик попыток и пробуем снова через 5 минут...');
            this.reconnectAttempts = 0;
            setTimeout(() => {
                this.reconnectPublic();
            }, 300000); // 5 минут
        }
    }


    // Закрытие соединений
    close() {
        console.log('🔒 Закрытие WebSocket соединений...');
        this.isConnected = false;
        this.stopConnectionMonitoring();
        
        if (this.publicWs) {
            this.publicWs.close();
            this.publicWs = null;
        }
        
        console.log('✅ WebSocket соединения закрыты');
    }

    // Получение статуса соединения
    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            lastDataReceived: this.lastDataReceived,
            timeSinceLastData: Date.now() - this.lastDataReceived,
            reconnectAttempts: this.reconnectAttempts,
            subscribedSymbols: this.subscribedSymbols.length,
            wsReadyState: this.publicWs ? this.publicWs.readyState : 'CLOSED'
        };
    }


    // Методы для обработки данных (будут переопределены в основном классе)
    onKlineData(message) {
        console.log('📊 Kline данные:', JSON.stringify(message, null, 2));
    }
}

module.exports = BybitWebSocket;
