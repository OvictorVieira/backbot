import Order from '../Backpack/Authenticated/Order.js';
import AccountController from './AccountController.js';
import Utils from '../utils/Utils.js';
import Markets from '../Backpack/Public/Markets.js';

class OrderController {

  async forceClose(position) {
    const Account = await AccountController.get()
    const market = Account.markets.find((el) => {
        return el.symbol === position.symbol
    })
    const isLong = parseFloat(position.netQuantity) > 0;
    const quantity = Math.abs(parseFloat(position.netQuantity));
    const decimal = market.decimal_quantity

    const body = {
        symbol: position.symbol,
        orderType: 'Market',
        side: isLong ? 'Ask' : 'Bid', // Ask if LONG , Bid if SHORT
        reduceOnly: true, 
        clientId: Math.floor(Math.random() * 1000000),
        quantity:String(quantity.toFixed(decimal))
    };

    return await Order.executeOrder(body);
  }

  async openOrder({ entry, stop, target, action, market, volume, decimal_quantity, decimal_price, stepSize_quantity }) {
    
    try {
    
    const isLong = action === "long";
    const side = isLong ? "Bid" : "Ask";

    const formatPrice = (value) => parseFloat(value).toFixed(decimal_price).toString();
    const formatQuantity = (value) => parseFloat(value).toFixed(decimal_quantity).toString();

    const entryPrice = parseFloat(entry);
    
    // Obtém o tickSize do mercado
    const marketInfo = await AccountController.get();
    const currentMarket = marketInfo?.markets?.find(m => m.symbol === market);
    const tickSize = currentMarket?.tickSize || 0.0001;

    // Obtém o preço atual do mercado para usar como referência
    const markPrices = await Markets.getAllMarkPrices(market);
    const currentMarketPrice = parseFloat(markPrices[0]?.markPrice || entryPrice);

    // Calcula a diferença percentual entre o preço de entrada e o preço atual
    const priceDiff = Math.abs(entryPrice - currentMarketPrice) / currentMarketPrice;
    
    // Ajusta o multiplicador baseado na volatilidade
    let tickMultiplier = 20; // Base mais conservador
    if (priceDiff < 0.001) { // Se muito próximo do mercado
      tickMultiplier = 30;
    } else if (priceDiff < 0.005) { // Se próximo do mercado
      tickMultiplier = 25;
    }

    // Usa o preço de mercado atual como base para evitar rejeições
    let adjustedPrice;
    if (isLong) {
      // Para compra: preço ligeiramente abaixo do preço atual do mercado
      adjustedPrice = currentMarketPrice - (tickSize * tickMultiplier);
    } else {
      // Para venda: preço ligeiramente acima do preço atual do mercado
      adjustedPrice = currentMarketPrice + (tickSize * tickMultiplier);
    }

    const quantity = formatQuantity(Math.floor((volume / adjustedPrice) / stepSize_quantity) * stepSize_quantity);
    const price = formatPrice(adjustedPrice);

    // Log do ajuste de preço
    console.log(`💰 ${market}: Preço estratégia ${entryPrice.toFixed(6)} → Preço mercado ${currentMarketPrice.toFixed(6)} → Ajustado ${adjustedPrice.toFixed(6)} (${isLong ? 'BID' : 'ASK'}) [Diff: ${(priceDiff * 100).toFixed(3)}%]`);

    const body = {
      symbol: market,
      side,
      orderType: "Limit",
      postOnly: true,  
      quantity,
      price,
      timeInForce: "GTC",
      selfTradePrevention: "RejectTaker"
    };

    const takeProfitTriggerPrice = (Number(target) + Number(price)) / 2 
    const stopLossTriggerPrice = (Number(stop) + Number(price)) / 2 

    if (target !== undefined && !isNaN(parseFloat(target))) {
      body.takeProfitTriggerBy = "LastPrice";
      body.takeProfitTriggerPrice = formatPrice(takeProfitTriggerPrice);
      body.takeProfitLimitPrice =  formatPrice(target);
    }

    if (stop !== undefined && !isNaN(parseFloat(stop))) {
      body.stopLossTriggerBy = "LastPrice";
      body.stopLossTriggerPrice = formatPrice(stopLossTriggerPrice);
      body.stopLossLimitPrice = formatPrice(stop);
    }

    if(body.quantity > 0 && body.price > 0){
      const result = await Order.executeOrder(body);
      
      // Se a ordem falhar, tenta com preço ainda mais conservador
      if (!result) {
        console.log(`⚠️ Tentando ordem com preço mais conservador para ${market}`);
        
        const moreConservativePrice = isLong 
          ? currentMarketPrice - (tickSize * (tickMultiplier + 15))  // Mais abaixo para compra
          : currentMarketPrice + (tickSize * (tickMultiplier + 15));  // Mais acima para venda
        
        body.price = formatPrice(moreConservativePrice);
        console.log(`💰 ${market}: Novo preço ${moreConservativePrice.toFixed(6)}`);
        
        return await Order.executeOrder(body);
      }
      
      return result;
    }

    } catch (error) {
      console.error('❌ OrderController.openOrder - Error:', error.message);
    }
  }

  async getRecentOpenOrders(market) {
    const orders = await Order.getOpenOrders(market)
    const orderShorted = orders.sort((a,b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    return orderShorted.map((el) => {
        return {
            id: el.id,
            minutes: Utils.minutesAgo(el.createdAt),
            triggerPrice: parseFloat(el.triggerPrice),
            price: parseFloat(el.price)
        }
    })
  }

  async getAllOrdersSchedule(markets_open) {
    const orders = await Order.getOpenOrders()
    const orderShorted = orders.sort((a,b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

    const list = orderShorted.map((el) => {
        return {
            id: el.id,
            minutes: Utils.minutesAgo(el.createdAt),
            triggerPrice: parseFloat(el.triggerPrice),
            symbol: el.symbol
        }
    })

    return list.filter((el) => !markets_open.includes(el.symbol)) 
  }

  async createStopTS({ symbol, price, isLong, quantity }) {

  const Account = await AccountController.get();
  const find = Account.markets.find(el => el.symbol === symbol);

  if (!find) throw new Error(`Symbol ${symbol} not found in account data`);

  const decimal_quantity = find.decimal_quantity;
  const decimal_price = find.decimal_price;
  const tickSize = find.tickSize * 10

  if (price <= 0) throw new Error("Invalid price: must be > 0");

  price = Math.abs(price); 
  
  const triggerPrice = isLong ? price - tickSize : price + tickSize  
  const formatPrice = (value) => parseFloat(value).toFixed(decimal_price).toString();
  const formatQuantity = (value) => parseFloat(value).toFixed(decimal_quantity).toString();
  const body = {
    symbol,
    orderType: 'Limit',
    side: isLong ? 'Ask' : 'Bid',
    reduceOnly: true,
    postOnly: true,  
    timeInForce: 'GTC',
    selfTradePrevention: "RejectTaker",
    price: formatPrice(price),
    triggerBy: 'LastPrice',
    triggerPrice: formatPrice(triggerPrice),
    triggerQuantity: formatQuantity(quantity),
  };

  return await Order.executeOrder(body);
  }

}

export default new OrderController();


