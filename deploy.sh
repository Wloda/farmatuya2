#!/bin/bash
echo "======================================"
echo "🚀 AUTO-DESPLIEGUE BW² (GITHUB PAGES)"
echo "======================================"

echo "1. Obteniendo últimos cambios (pull)..."
git pull origin main

echo "2. Agregando archivos modificados..."
git add .

echo "3. Creando registro (commit)..."
git commit -m "auto-deploy: $(date '+%Y-%m-%d %H:%M:%S')"

echo "4. Subiendo al servidor (push)..."
git push origin main

echo "======================================"
echo "✅ DESPLIEGUE INICIADO"
echo "Tus cambios estarán en vivo en https://www.bw2.ai en 1 o 2 minutos."
echo "Recuerda usar Cmd + Shift + R si tu navegador tiene caché."
echo "======================================"
