# OCR assets bundled for Multiway image review

These files are loaded only after the user chooses **Tentar reconhecer cartas**.
Recognition runs in a browser worker. The selected image is not sent to the
THEIBS server or an OCR service.

- `tesseract.min.js`, `worker.min.js`: Tesseract.js 5.0.0 from
  `https://cdn.jsdelivr.net/npm/tesseract.js@5.0.0/dist/`.
- `tesseract-core*.wasm.js`, `tesseract-core*.wasm`: Tesseract.js Core 5.0.0
  from `https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0/`.
- `eng.traineddata.gz`: English fast data from
  `https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz`.

The accompanying `LICENSE.*` files contain the upstream license texts.
The profile coordinates are provisional and require validation with user-provided
screenshots from the selected table themes. OCR scores are not calibrated
probabilities of a correct card. Human review is required before a card enters
the Multiway hand.
