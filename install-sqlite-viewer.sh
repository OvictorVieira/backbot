#!/bin/bash

echo "🔧 Instalando SQLite Viewer para Cursor..."

# Verificar se o Cursor está instalado
if command -v cursor &> /dev/null; then
    echo "✅ Cursor encontrado"
    
    # Instalar a extensão SQLite Viewer
    echo "📦 Instalando extensão SQLite Viewer..."
    cursor --install-extension qwtel.sqlite-viewer
    
    echo "✅ Extensão instalada com sucesso!"
    echo ""
    echo "🎯 Como usar:"
    echo "1. Abra o arquivo: src/persistence/bot.db"
    echo "2. Ou use Ctrl+Shift+P e digite: 'SQLite: Open Database'"
    echo "3. Selecione: src/persistence/bot.db"
    echo ""
    echo "📊 Você poderá visualizar as tabelas:"
    echo "   - bot_configs (configurações dos bots)"
    echo "   - bot_orders (histórico de ordens)"
    echo "   - trailing_state (estado do trailing stop)"
else
    echo "❌ Cursor não encontrado no PATH"
    echo "💡 Certifique-se de que o Cursor está instalado e no PATH"
fi
