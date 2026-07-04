# Caderno para Natura

Aplicação web mobile-first que lê códigos e quantidades de uma foto, exige conferência manual e gera a planilha de importação Natura em `.xlsx`.

## Como executar

1. Instale o [Tesseract OCR](https://github.com/UB-Mannheim/tesseract/wiki) com o idioma português.
2. Crie o ambiente e instale as dependências:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```

3. Inicie o sistema:

   ```powershell
   python run.py
   ```

4. Abra `http://localhost:8000`. Para usar a câmera de outro celular na rede, publique o serviço com HTTPS; navegadores móveis exigem contexto seguro para câmera e compartilhamento de arquivos.

O histórico fica em `data/natura.db` e os arquivos gerados em `data/generated/`.

## Leitura manuscrita com Gemini

Defina `GEMINI_API_KEY` no ambiente para usar a leitura de imagem com IA. Sem essa
variável, ou se a API estiver indisponível, o sistema usa Tesseract automaticamente.
O modelo pode ser alterado opcionalmente com `GEMINI_MODEL`.

## Testes

```powershell
pytest -q
```
