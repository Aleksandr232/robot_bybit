const axios = require('axios');
const crypto = require('crypto');

class BybitRestApi {
    constructor(config) {
        this.config = config;
        this.apiKey = config.apiKey;
        this.apiSecret = config.apiSecret;
        this.testnet = config.testnet || true;
        
        // Базовый URL для демо API
        this.baseUrl = 'https://api-demo.bybit.com';
        
        // Создание экземпляра axios с базовой конфигурацией
        this.client = axios.create({
            baseURL: this.baseUrl,
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }

    // Создание подписи для REST API
    createSignature(timestamp, recvWindow = 5000, params = '') {
        const message = `${timestamp}${this.apiKey}${recvWindow}${params}`;
        return crypto.createHmac('sha256', this.apiSecret).update(message).digest('hex');
    }

    // Получение заголовков для аутентификации
    getAuthHeaders(params = '') {
        const timestamp = Date.now();
        const recvWindow = 5000;
        const signature = this.createSignature(timestamp, recvWindow, params);

        return {
            'X-BAPI-API-KEY': this.apiKey,
            'X-BAPI-SIGN': signature,
            'X-BAPI-SIGN-TYPE': '2',
            'X-BAPI-TIMESTAMP': timestamp.toString(),
            'X-BAPI-RECV-WINDOW': recvWindow.toString()
        };
    }

    // Получение баланса кошелька
    async getWalletBalance(accountType = 'UNIFIED') {
        try {
            const params = `accountType=${accountType}`;
            const headers = this.getAuthHeaders(params);
            
            const response = await this.client.get(`/v5/account/wallet-balance?${params}`, {
                headers
            });

            console.log('💰 Получен баланс кошелька:', response.data);
            return response.data;
        } catch (error) {
            console.error('❌ Ошибка получения баланса:', error.response?.data || error.message);
            throw error;
        }
    }

    // Получение позиций
    async getPositions(category = null, symbol = null) {
        try {
            const cat = category || this.config?.trading?.category || 'linear';
            let params = `category=${cat}`;
            if (symbol) {
                params += `&symbol=${symbol}`;
            }

            const headers = this.getAuthHeaders(params);
            
            const response = await this.client.get(`/v5/position/list?${params}`, {
                headers
            });

            console.log('📈 Получены позиции:', response.data);
            return response.data;
        } catch (error) {
            console.error('❌ Ошибка получения позиций:', error.response?.data || error.message);
            throw error;
        }
    }

    // Размещение рыночного ордера
    async placeMarketOrder(symbol, side, qty, timeInForce = 'IOC') {
        try {
            // Дополнительная проверка и логирование параметров
            console.log(`🔍 Параметры ордера для ${symbol}:`, {
                symbol: symbol,
                side: side,
                qty: qty,
                qtyType: typeof qty,
                qtyString: qty.toString(),
                timeInForce: timeInForce
            });

            // Проверка минимальных требований
            const minQty = this.getMinQty(symbol);
            if (parseFloat(qty) < minQty) {
                throw new Error(`Количество ${qty} меньше минимального ${minQty} для ${symbol}`);
            }

            const orderData = {
                category: this.config?.trading?.category || 'linear',
                symbol: symbol,
                side: side,
                orderType: 'Market',
                qty: qty.toString(),
                timeInForce: timeInForce,
                positionIdx: 0  // 0 = one-way mode, 1 = buy side of hedge-mode, 2 = sell side of hedge-mode
            };

            console.log(`📤 Отправляем ордер:`, orderData);

            const params = JSON.stringify(orderData);
            const headers = this.getAuthHeaders(params);
            
            const response = await this.client.post('/v5/order/create', orderData, {
                headers
            });

            console.log(`📋 Размещен рыночный ордер: ${side} ${qty} ${symbol}`, response.data);
            return response.data;
        } catch (error) {
            console.error('❌ Ошибка размещения рыночного ордера:', error.response?.data || error.message);
            throw error;
        }
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
            'TRXUSDT': 1        // 1 TRX
        };
        
        return minQtyMap[symbol] || 0.01;
    }

    // Размещение лимитного ордера
    async placeLimitOrder(symbol, side, qty, price, timeInForce = 'GTC') {
        try {
            const orderData = {
                category: this.config?.trading?.category || 'linear',
                symbol: symbol,
                side: side,
                orderType: 'Limit',
                qty: qty.toString(),
                price: price.toString(),
                timeInForce: timeInForce,
                positionIdx: 0  // 0 = one-way mode, 1 = buy side of hedge-mode, 2 = sell side of hedge-mode
            };

            const params = JSON.stringify(orderData);
            const headers = this.getAuthHeaders(params);
            
            const response = await this.client.post('/v5/order/create', orderData, {
                headers
            });

            console.log(`📋 Размещен лимитный ордер: ${side} ${qty} ${symbol} @ ${price}`, response.data);
            return response.data;
        } catch (error) {
            console.error('❌ Ошибка размещения лимитного ордера:', error.response?.data || error.message);
            throw error;
        }
    }

    // Размещение ордера с Take Profit и Stop Loss
    async placeOrderWithTPSL(symbol, side, qty, price, takeProfit, stopLoss, orderType = 'Market') {
        try {
            console.log(`🔍 Параметры ордера с TP/SL для ${symbol}:`, {
                symbol: symbol,
                side: side,
                qty: qty,
                price: price,
                takeProfit: takeProfit,
                stopLoss: stopLoss,
                orderType: orderType
            });

            const orderData = {
                category: this.config?.trading?.category || 'linear',
                symbol: symbol,
                side: side,
                orderType: orderType,
                qty: qty.toString(),
                timeInForce: orderType === 'Market' ? 'IOC' : 'GTC',
                positionIdx: 0,
                takeProfit: takeProfit.toString(),
                stopLoss: stopLoss.toString(),
                tpslMode: 'Partial',
                tpOrderType: 'Market',
                slOrderType: 'Market'
            };

            // Добавляем цену только для лимитных ордеров
            if (orderType === 'Limit') {
                orderData.price = price.toString();
            }

            console.log(`📤 Отправляем ордер с TP/SL:`, orderData);

            const params = JSON.stringify(orderData);
            const headers = this.getAuthHeaders(params);
            
            const response = await this.client.post('/v5/order/create', orderData, {
                headers
            });

            console.log(`📋 Размещен ордер с TP/SL: ${side} ${qty} ${symbol}`, response.data);
            return response.data;
        } catch (error) {
            console.error('❌ Ошибка размещения ордера с TP/SL:', error.response?.data || error.message);
            throw error;
        }
    }

    // Размещение стоп-ордера
    async placeStopOrder(symbol, side, qty, stopPrice) {
        try {
            const orderData = {
                category: this.config?.trading?.category || 'linear',
                symbol: symbol,
                side: side,
                orderType: 'Stop',
                qty: qty.toString(),
                stopPrice: stopPrice.toString(),
                positionIdx: 0
            };

            const params = JSON.stringify(orderData);
            const headers = this.getAuthHeaders(params);
            
            const response = await this.client.post('/v5/order/create', orderData, {
                headers
            });

            console.log(`📋 Размещен стоп-ордер: ${side} ${qty} ${symbol} @ ${stopPrice}`, response.data);
            return response.data;
        } catch (error) {
            console.error('❌ Ошибка размещения стоп-ордера:', error.response?.data || error.message);
            throw error;
        }
    }

    // Отмена ордера
    async cancelOrder(symbol, orderId) {
        try {
            const cancelData = {
                category: this.config?.trading?.category || 'linear',
                symbol: symbol,
                orderId: orderId
            };

            const params = JSON.stringify(cancelData);
            const headers = this.getAuthHeaders(params);
            
            const response = await this.client.post('/v5/order/cancel', cancelData, {
                headers
            });

            console.log(`❌ Отменен ордер: ${orderId} для ${symbol}`, response.data);
            return response.data;
        } catch (error) {
            console.error('❌ Ошибка отмены ордера:', error.response?.data || error.message);
            throw error;
        }
    }

    // Получение активных ордеров
    async getActiveOrders(category = null, symbol = null) {
        try {
            const cat = category || this.config?.trading?.category || 'linear';
            let params = `category=${cat}`;
            if (symbol) {
                params += `&symbol=${symbol}`;
            }

            const headers = this.getAuthHeaders(params);
            
            const response = await this.client.get(`/v5/order/realtime?${params}`, {
                headers
            });

            console.log('📋 Получены активные ордера:', response.data);
            return response.data;
        } catch (error) {
            console.error('❌ Ошибка получения ордеров:', error.response?.data || error.message);
            throw error;
        }
    }

    // Получение истории ордеров
    async getOrderHistory(category = null, symbol = null, limit = 20) {
        try {
            const cat = category || this.config?.trading?.category || 'linear';
            let params = `category=${cat}&limit=${limit}`;
            if (symbol) {
                params += `&symbol=${symbol}`;
            }

            const headers = this.getAuthHeaders(params);
            
            const response = await this.client.get(`/v5/order/history?${params}`, {
                headers
            });

            console.log('📋 Получена история ордеров:', response.data);
            return response.data;
        } catch (error) {
            console.error('❌ Ошибка получения истории ордеров:', error.response?.data || error.message);
            throw error;
        }
    }

    // Получение истории исполнений
    async getExecutionHistory(category = null, symbol = null, limit = 20) {
        try {
            const cat = category || this.config?.trading?.category || 'linear';
            let params = `category=${cat}&limit=${limit}`;
            if (symbol) {
                params += `&symbol=${symbol}`;
            }

            const headers = this.getAuthHeaders(params);
            
            const response = await this.client.get(`/v5/execution/list?${params}`, {
                headers
            });

            console.log('⚡ Получена история исполнений:', response.data);
            return response.data;
        } catch (error) {
            console.error('❌ Ошибка получения истории исполнений:', error.response?.data || error.message);
            throw error;
        }
    }

    // Получение информации об инструменте
    async getInstrumentInfo(category = null, symbol = null) {
        try {
            const cat = category || this.config?.trading?.category || 'linear';
            let params = `category=${cat}`;
            if (symbol) {
                params += `&symbol=${symbol}`;
            }

            const response = await this.client.get(`/v5/market/instruments-info?${params}`);

            console.log('📊 Получена информация об инструменте:', response.data);
            return response.data;
        } catch (error) {
            console.error('❌ Ошибка получения информации об инструменте:', error.response?.data || error.message);
            throw error;
        }
    }

    // Получение текущей цены
    async getCurrentPrice(symbol) {
        try {
            const category = this.config?.trading?.category || 'linear';
            const response = await this.client.get(`/v5/market/tickers?category=${category}&symbol=${symbol}`);
            
            if (response.data.retCode === 0 && response.data.result.list.length > 0) {
                const price = parseFloat(response.data.result.list[0].lastPrice);
                console.log(`💰 Текущая цена ${symbol}: ${price}`);
                return price;
            }
            
            throw new Error('Не удалось получить цену');
        } catch (error) {
            console.error(`❌ Ошибка получения цены для ${symbol}:`, error.response?.data || error.message);
            throw error;
        }
    }

    // Получение исторических данных kline
    async getKlineData(symbol, interval = '1', limit = 200) {
        try {
            const category = this.config?.trading?.category || 'linear';
            const response = await this.client.get(`/v5/market/kline?category=${category}&symbol=${symbol}&interval=${interval}&limit=${limit}`);
            
            if (response.data.retCode === 0) {
                console.log(`📊 Получены kline данные для ${symbol}: ${response.data.result.list.length} свечей`);
                return response.data.result.list;
            }
            
            throw new Error('Не удалось получить kline данные');
        } catch (error) {
            console.error(`❌ Ошибка получения kline данных для ${symbol}:`, error.response?.data || error.message);
            throw error;
        }
    }

    // Закрытие позиции (размещение противоположного ордера)
    async closePosition(symbol, side, qty) {
        try {
            const closeSide = side === 'Buy' ? 'Sell' : 'Buy';
            return await this.placeMarketOrder(symbol, closeSide, qty);
        } catch (error) {
            console.error(`❌ Ошибка закрытия позиции ${symbol}:`, error);
            throw error;
        }
    }

    // Проверка статуса API
    async checkApiStatus() {
        try {
            const response = await this.client.get('/v5/market/time');
            console.log('✅ API статус:', response.data);
            return response.data.retCode === 0;
        } catch (error) {
            console.error('❌ Ошибка проверки статуса API:', error.message);
            return false;
        }
    }
}

module.exports = BybitRestApi;
