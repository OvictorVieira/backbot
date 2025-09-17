# Claude Code Import Guidelines

## 🚨 REGRAS CRÍTICAS DE IMPORT - NUNCA ESQUECER

### ❌ NUNCA FAÇA ISSO:
```javascript
// ERRADO - Import dinâmico no meio do código
const RequestManager = (await import('./src/Utils/RequestManager.js')).default;
RequestManager.forceReset();

// ERRADO - Import no meio de função
function someFunction() {
  const SomeClass = require('./SomeClass.js');
  // ...
}
```

### ✅ SEMPRE FAÇA ISSO:
```javascript
// CORRETO - Imports sempre no topo do arquivo
import RequestManager from './src/Utils/RequestManager.js';
import SomeClass from './SomeClass.js';
import AnotherClass from './AnotherClass.js';

// Depois o resto do código
function someFunction() {
  RequestManager.forceReset();
  // ...
}
```

## 📋 REGRAS OBRIGATÓRIAS:

1. **TODOS os imports devem estar no TOPO do arquivo**
2. **NUNCA use imports dinâmicos** a menos que seja absolutamente necessário
3. **Organize imports por categorias:**
   - Dependencies externas primeiro
   - Imports internos depois
   - Ordem alfabética dentro de cada categoria

4. **Use import estático sempre:**
   ```javascript
   import MyClass from './MyClass.js';
   ```

5. **Se precisar de import condicional, use no topo com lazy loading:**
   ```javascript
   const MyClass = lazy(() => import('./MyClass.js'));
   ```

## 🔍 VERIFICAÇÃO:
- Se você ver `await import()` ou `require()` no meio do código, MOVA para o topo
- Se você ver erro "X is not a function", verifique se o import está no topo
- Sempre rode sintaxe check após mudanças de import

## 💡 EXEMPLO CORRETO COMPLETO:
```javascript
// External dependencies
import express from 'express';
import cors from 'cors';

// Internal utilities
import Logger from './src/Utils/Logger.js';
import RequestManager from './src/Utils/RequestManager.js';

// Internal services
import AccountController from './src/Controllers/AccountController.js';
import OrderController from './src/Controllers/OrderController.js';

// Rest of the code...
```

**ESTA REGRA É INVIOLÁVEL - SEMPRE IMPORTE NO TOPO DO ARQUIVO!**