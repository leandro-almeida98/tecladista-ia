---
name: tecladista-architecture
description: Regras de arquitetura do Tecladista IA — app único React/Vite na raiz, camadas, estrutura de pastas, fluxo de dados. Consulte antes de qualquer alteração estrutural.
---

# Arquitetura Tecladista IA

## 1. Projeto

App único na raiz do repo:
- React 19 + TypeScript strict + Vite 7
- Tailwind CSS v4 (utility-first), Zustand, React Router v7 (data router), Axios
- Sem backend próprio — API externa consumida via `VITE_API_URL`

## 2. Estrutura de Pastas

```
src/
├── api/          # services axios (1 por módulo)
├── components/   # componentes compartilhados
├── hooks/        # hooks customizados
├── pages/        # páginas (1 arquivo = 1 rota)
│   └── <modulo>/ # páginas agrupadas por módulo
├── store/        # stores Zustand
├── test/         # setup canônico de testes (setup.ts)
├── types/        # tipos/interface TS
└── routes/       # definição de rotas React Router
```

### Regras

- Pages em `src/pages/<modulo>/`, export default
- Components puros (sem página) em `src/components/` (sem `page` no nome)
- Stores em `src/store/`, 1 store por contexto (auth, ui, etc), `create<StoreType>()(...)`
- API services em `src/api/`, funções soltas (não classes), axiosInstance única compartilhada
- Hooks em `src/hooks/`, prefixo `use`, 1 hook por arquivo
- Rotas centralizadas em `src/routes/` (data router)
- Setup canônico de testes em `src/test/setup.ts`

## 3. Fluxo de Dados

```
Componente (página)
  → store Zustand (estado global + ações)
  → api service (função solta, axiosInstance)
  → HTTP (base URL de VITE_API_URL)
  ← resposta tipada (src/types/)
  ← store atualiza estado
  ← componente re-renderiza
```

- Axios interceptor: adiciona Bearer token e renova em 401
- Erros: try/catch no service/hook com feedback na UI (toast)

## 4. Testes

- Unitário: Vitest + Testing Library (`src/test/setup.ts`)
- E2E: Playwright (`npm run test:e2e`)
- Cobertura mínima: 95% POR ARQUIVO (quality gate automático)
