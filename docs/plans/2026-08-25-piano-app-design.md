# Design — Piano Learning App (Synthesia/Piano Tiles)

Data: 2026-08-25
Status: APROVADO

## Objetivo

Web app de aprendizado de piano estilo Synthesia/Piano Tiles: importa `.mid`, renderiza notas caindo em Canvas 60 FPS alinhadas ao teclado virtual de 61 teclas (Casio CT-S300), conecta via Web MIDI API ao hardware, acende teclas em tempo real e julga acertos (Perfect/Good/Miss) com score/combo.

## Localização

App inteiro isolado em subpasta do repo: `tecladista-ai-src/` (package.json, src/, Dockerfile, docker-compose.yml — tudo dentro). Versionado no git.

## Stack

- React 19 + TypeScript strict + Vite 7
- Tailwind CSS v4 via `@tailwindcss/vite`
- `@tonejs/midi` — parse de `.mid`
- Web MIDI API nativa (sem lib)
- Canvas 2D + `requestAnimationFrame`
- Zustand — estado global

## Estrutura de pastas (dentro de tecladista-ai-src/)

```
src/
├── components/
│   ├── PianoKeyboard.tsx      # 61 teclas (C2–C7), acende em tempo real
│   ├── FallingNotesCanvas.tsx # motor Canvas + rAF
│   ├── MidiFileInput.tsx      # import .mid
│   ├── ScorePanel.tsx         # score/combo/accuracy/judgment
│   └── TransportControls.tsx  # play/pause/restart
├── hooks/
│   ├── useMidiConnection.ts   # Casio CT-S300
│   └── useGameLoop.ts         # rAF loop
├── lib/
│   ├── midiParser.ts          # .mid → Note[]
│   ├── noteMath.ts            # nota→x, velocidade queda, hitbox
│   └── scoring.ts             # julgamento Perfect/Good/Miss
├── types/midi.ts
├── store/gameStore.ts         # Zustand
├── pages/GamePage.tsx
├── App.tsx
└── main.tsx
```

## Arquitetura / fluxo de dados

- **useMidiConnection**: `requestMIDIAccess()` → filtra input por nome contendo `CT-S300` (fallback: 1º input) → `onmidimessage` parseia `noteon/noteoff/velocity` → mantém `activeNotes` (Set de MIDI numbers). Retorna `{ status, inputs, activeNotes, connect }`.
- **midiParser**: `new Midi(arrayBuffer)` → achata tracks → `{ midi, time, duration }` em segundos → filtra range 61 teclas (MIDI 36–96) → dedupe → ordena por tempo.
- **Motor (FallingNotesCanvas)**: canvas full-screen acima do teclado. `x = f(midi→índice tecla)`, `y = hitLineY - (noteTime - currentTime) * pxPerSec`. Nota chega à linha de hit exatamente no timestamp. Estado por-frame em refs (não React state) p/ 60 FPS.
- **Hitbox/julgamento**: quando nota cruza hit line, checa se tecla correspondente está em `activeNotes`. Janelas: Perfect ±50ms, Good ±100ms, Miss se passou sem press. Score: Perfect +100, Good +50. Combo + accuracy.
- **Teclado virtual**: 61 teclas, acende quando `activeNotes` contém a nota. Clique do mouse como fallback (sem hardware).

## Erros

- MIDI negado → mensagem + fallback mouse
- Sem dispositivo → estado "no device"
- `.mid` inválido → toast
- Resize do canvas → redimensiona

## Testes

- Unit: `midiParser` (mock .mid), `noteMath` (velocidade/x), `scoring` (janelas), `useMidiConnection` (mock MIDIAccess)
- Playwright: mock MIDI, importa .mid gerado, verifica teclado/notas renderizam
- Gate: build + teste + cobertura 95%/arquivo

## Docker (porta 5183)

- `Dockerfile`: node:22-alpine → build → nginx serve estático
- `docker-compose.yml`: `5183:80`
- Web MIDI funciona em `localhost:5183` (secure context)