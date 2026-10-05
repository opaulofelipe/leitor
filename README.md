# Folha — leitor responsivo

Projeto estático em HTML, CSS e JavaScript para abrir **EPUB**, **PDF** ou texto colado e exibir o conteúdo em um leitor paginado.

## Recursos

- EPUB processado no navegador com epub.js.
- PDF processado no navegador com PDF.js.
- Texto colado diretamente.
- Paginação recalculada conforme tamanho de tela, fonte e entrelinha.
- Gesto horizontal de arrastar para trocar de página.
- Animação 3D de virada de página.
- Botões anterior/próximo no desktop.
- Teclas ← →, Page Up e Page Down.
- Temas papel, sépia e escuro.
- Preferências de leitura salvas no `localStorage`.
- Sem backend: adequado para GitHub Pages.

## Publicar no GitHub Pages

1. Crie um repositório.
2. Envie `index.html`, `styles.css` e `app.js` para a raiz.
3. No GitHub, abra **Settings → Pages**.
4. Em **Build and deployment**, selecione **Deploy from a branch**.
5. Selecione a branch `main` e a pasta `/ (root)`.
6. Salve.

## Dependências externas

O projeto usa CDNs:
- epub.js 0.3.93
- PDF.js 6.3.289

Por isso, a primeira abertura precisa de conexão com a internet para carregar essas bibliotecas.

## Limitações

### PDFs digitalizados
A leitura de PDF depende da camada de texto do documento. PDFs formados apenas por imagens precisam de OCR, que não está incluído nesta versão.

### Layout original
O objetivo é um **leitor de texto responsivo**, não reproduzir visualmente a diagramação original. Imagens, tabelas e elementos gráficos de EPUB/PDF não são preservados no modo de leitura.

### Privacidade
O arquivo selecionado é lido pela API de arquivos do próprio navegador. O projeto não possui código de upload para servidor.
