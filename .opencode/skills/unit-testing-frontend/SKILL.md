---
name: unit-testing-frontend
description: Guia completo para criação de testes unitários FRONTEND no Tecladista IA — React, TypeScript, Vitest, Testing Library, userEvent. Use QUANDO criar/modificar testes de componentes, páginas, hooks, stores ou serviços de API. Trigger: "criar testes frontend", "testes unitários", "vitest", "testing library", "componente", "navegação", "voltar", "formulario", "cobertura frontend", "mock de store", "mock de api".
---

# Unit Testing — Frontend (Tecladista IA)

Guia canônico para testes unitários **frontend** no app único na raiz do repo: React 19 + TypeScript strict + Vitest + Testing Library + userEvent.

> Regra de ouro: **teste o comportamento, não a implementação.** O teste deve sobreviver a uma refatoração interna sem precisar mudar.

---

## 1. Princípios Fundamentais

### 1.1 Foco em comportamento
- Teste o **resultado observável**: o que o usuário vê na tela (`screen.getByRole`), o estado final do store, a chamada à API com payload correto. Nunca detalhes internos (ordem de chamadas privadas, valores intermediários de variável local).
- Pergunte-se: "Se eu renomear uma variável interna ou extrair uma função, este teste quebra?" Se sim, está testando implementação.

### 1.2 Pirâmide de cenários (obrigatória por unidade testada)
Cada componente/página/hook deve cobrir no mínimo:

| Camada | Descrição | Exemplo |
|--------|-----------|---------|
| **Happy path** | Fluxo normal de sucesso | Usuário preenche formulário válido → toast de sucesso + lista atualizada |
| **Edge cases** | Inputs inválidos | `null`, `undefined`, `""`, array vazio, string com 10k chars, busca sem resultado |
| **Boundary** | Valores limite | Lista com 0 itens, 1 item, carrinho vazio, preço R$ 0,00, página 0 |
| **Error flow** | Falhas externas/internas | API retorna 404/500, timeout, rede offline, mock rejeita promise |

### 1.3 Isolamento React
- `vi.mock()` em services de API, stores Zustand e hooks — nunca deixe o teste bater na rede nem no store real.
- jsdom limpo entre testes: `afterEach(() => cleanup())` via setup canônico (seção 3.1).
- Store Zustand mockado com factory controla estado injetado (seção 3.3).
- Rotas isoladas com `MemoryRouter` via `renderWithRouter` (seção 3.4).

### 1.4 FIRST
- **F**ast — testes rodam em milissegundos (sem `setTimeout`, sem rede).
- **I**solated — nenhum teste depende de outro (estado do mock resetado em `beforeEach`).
- **R**epeatable — roda em qualquer máquina, qualquer hora, sem variável de ambiente real.
- **S**elf-validating — passa/fail via assert, sem inspeção manual de `console.log`.
- **T**imely — escrito junto com o código (idealmente antes — TDD, seção 12).

---

## 2. Cenários de Usuário Real (Crítico)

Teste unitário isolado não basta. Simule **o que o usuário faria de verdade** no app.

### 2.1 Navegação entre páginas
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

test('deveNavegarParaDetalhesDoItem_quandoClicaNoItemDoCardapio', async () => {
  render(
    <MemoryRouter initialEntries={['/menu']}>
      <Routes>
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/menu/:id" element={<ItemDetailPage />} />
      </Routes>
    </MemoryRouter>
  );

  await userEvent.click(screen.getByRole('link', { name: /pizza margherita/i }));
  expect(screen.getByRole('heading', { name: /detalhes do item/i })).toBeInTheDocument();
});
```

### 2.2 Botão voltar — restauração de estado
O usuário espera que filtros, busca e carrinho sobrevivam à navegação de ida-e-volta.
```tsx
test('deveRestaurarFiltroDeCategoria_quandoVoltaDaPaginaDeDetalhes', async () => {
  const user = userEvent.setup();
  render(<MenuPage />);

  // Aplica filtro
  await user.click(screen.getByRole('button', { name: /filtrar/i }));
  await user.selectOptions(screen.getByLabelText(/categoria/i), 'Bebidas');
  await user.click(screen.getByRole('link', { name: /suco de laranja/i }));

  // Volta
  await user.click(screen.getByRole('button', { name: /voltar/i }));

  // Assert estado restaurado
  expect(screen.getByLabelText(/categoria/i)).toHaveValue('Bebidas');
  expect(screen.getByRole('heading', { name: /menu/i })).toBeInTheDocument();
});
```

### 2.3 Formulário completo
Preencha campo a campo com `user.type` e submeta — não chame a função de submit diretamente.
```tsx
test('deveExibirToastDeSucesso_quandoSubmitFormularioValido', async () => {
  const user = userEvent.setup();
  createCouponMock.mockResolvedValue({ data: { id: '1' } });

  render(<CouponsPage />);

  await user.type(screen.getByLabelText(/código/i), 'DESC10');
  await user.type(screen.getByLabelText(/desconto/i), '10');
  await user.click(screen.getByRole('button', { name: /salvar/i }));

  expect(await screen.findByText(/cupom criado com sucesso/i)).toBeInTheDocument();
  expect(createCouponMock).toHaveBeenCalledWith(expect.objectContaining({ code: 'DESC10' }));
});
```

### 2.4 Timeouts / retry
- **NUNCA** `setTimeout` hardcoded para sincronizar.
- Use `findBy*` com timeout realista (10–15s) para fluxos assíncronos com retry/loading:
```tsx
expect(await screen.findByText(/pedido confirmado/i, {}, { timeout: 15000 })).toBeInTheDocument();
```

### 2.5 Fluxo multi-step (checkout)
```tsx
test('deveFinalizarPedido_quandoFluxoDeCheckoutCompleto', async () => {
  const user = userEvent.setup();
  render(<CheckoutFlow />);

  // 1. Escolhe produto
  await user.click(screen.getByRole('button', { name: /pizza margherita/i }));
  // 2. Customiza
  await user.click(screen.getByRole('checkbox', { name: /borda recheada/i }));
  // 3. Adiciona ao carrinho
  await user.click(screen.getByRole('button', { name: /adicionar ao carrinho/i }));
  // 4. Vai ao carrinho
  await user.click(screen.getByRole('link', { name: /carrinho/i }));
  expect(screen.getByText(/pizza margherita/i)).toBeInTheDocument();
  // 5. Checkout
  await user.click(screen.getByRole('button', { name: /finalizar pedido/i }));
  // 6. Pagamento
  await user.click(screen.getByRole('button', { name: /pix/i }));
  // 7. Confirmação
  expect(await screen.findByText(/pedido confirmado/i)).toBeInTheDocument();
});
```

---

## 3. Padrões Vitest + Testing Library

### 3.1 Setup canônico
Path único no app: `src/test/setup.ts`.

`setup.ts`:
```ts
import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
```

`vite.config.ts` deve apontar `test.setupFiles` para o arquivo do setup.

### 3.2 Mock de API/service
Mock o módulo inteiro, nunca o axiosInstance real.
```ts
import { vi, type Mock } from 'vitest';
import * as menuService from '../../api/menuService';

vi.mock('../../api/menuService', () => ({
  getMenu: vi.fn(),
  createItem: vi.fn(),
}));

// No teste:
(menuService.getMenu as Mock).mockResolvedValue({ data: mockMenu });
```

### 3.3 Mock de store Zustand com factory
Para stores que mudam de estado entre testes, use factory resetada em `beforeEach`:
```ts
const mockStore = vi.fn();

vi.mock('../../store/useCartStore', () => ({
  useCartStore: mockStore,
}));

beforeEach(() => {
  mockStore.mockReturnValue({ items: [], addItem: vi.fn(), total: 0 });
});
```

Mock de auth (rota protegida, ver seção 4.3):
```ts
vi.mock('../../store/useAuthStore', () => ({
  useAuthStore: vi.fn(() => ({
    token: 'fake-jwt',
    restaurantId: 'rest-1',
    email: 'test@example.com',
  })),
}));
```

### 3.4 Wrapper `renderWithRouter`
```tsx
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

interface RenderWithRouterOptions extends Omit<RenderOptions, 'wrapper'> {
  route?: string;
  routes?: ReactElement;
}

export function renderWithRouter(ui: ReactElement, options: RenderWithRouterOptions = {}) {
  const { route = '/', routes, ...renderOptions } = options;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[route]}>
      {routes ? (
        <Routes>
          {routes}
          <Route path="*" element={children} />
        </Routes>
      ) : (
        children
      )}
    </MemoryRouter>
  );

  return render(ui, { wrapper, ...renderOptions });
}
```

### 3.5 Regras inegociáveis
| Prefira | Evite |
|---------|-------|
| `userEvent` (`userEvent.setup()`) | `fireEvent` (exceto eventos que userEvent não suporta) |
| `screen.getByRole` / `getByLabelText` / `getByText` | `getByTestId` (use só se não houver role adequado) |
| `findBy*` (com timeout 10–15s) | `waitFor(() => getBy*())` |
| Assert em texto/role visível | `document.querySelector` |
| `toBeInTheDocument` + assert semântico | snapshot como único assert |

### 3.6 Regras de nome (português ou inglês — consistente por arquivo)
- PT: `deve[Resultado]_quando[Contexto]` → `deveExibirErro_quandoApiRetorna500`
- EN: `should[Result]_when[Context]` → `shouldShowError_whenApiReturns500`

---

## 4. Testes ÚTEIS vs INÚTEIS (Crítica)

Nem todo teste agrega valor. Teste inútil dá falsa sensação de segurança, gasta CI e trava refatorações. Classifique antes de escrever.

### 4.1 Testes INÚTEIS — NÃO criar

| # | Anti-padrão | Exemplo do que NÃO fazer | Por quê |
|---|-------------|---------------------------|---------|
| 1 | Testar getter/setter de DTO/interface (sem lógica) | `expect(menuItem.name).toBe('Pizza')` após `new MenuItem({ name: 'Pizza' })` — sem nenhuma transformação | TS strict já valida tipos em compile-time; assert só reescreve a atribuição |
| 2 | Testar que React renderiza `<div>`/JSX estático | `render(<Footer />); expect(screen.getByText('© 2026 Tecladista IA')).toBeInTheDocument()` — sem interação, sem lógica | Testa o framework (framework test); quebra a cada ajuste cosmético sem revelar bug |
| 3 | `expect(mock).toHaveBeenCalled()` sem validar EFEITO visível | `await user.click(button); expect(addItemMock).toHaveBeenCalled()` e nada mais | Não prova que o resultado apareceu; o handler pode lançar depois da chamada e o teste passa. Valide o efeito: item no DOM, badge do carrinho, toast |
| 4 | Testar função que só retorna o mockado (circular) | `service.getMenu = vi.fn().mockResolvedValue(X)`; `const result = await useMenu(); expect(result).toBe(X)` — sem transformação no meio | Circular: mock retorna X, função retorna X, teste asserta X. Nada é exercitado |
| 5 | Snapshot como único assert | `expect(container).toMatchSnapshot()` sem nenhum assert semântico | Snapshot não valida semântica; vira ruído que todo mundo aprova com `-u` sem olhar |
| 6 | Validar classe Tailwind/CSS | `expect(button).toHaveClass('bg-red-500')` | Testa utility class, não comportamento; refatoração visual quebra teste sem bug nenhum |
| 7 | 20 linhas de mock para validar 1 linha trivial | `vi.mock` de 3 módulos + store + router para testar `const total = items.reduce(...)` | Proporção absurda mock:código — sinal de que o código deveria ser função pura testada isolada (seção 6) |
| 8 | Duplicar assert de outro teste do mesmo arquivo | Dois `test()` com mesmos mocks, mesma interação, mesmo assert — mudando só o nome | Sem cenário novo não há valor novo; cada teste precisa de pelo menos um assert exclusivo |
| 9 | Testar framework/router | `render(<MemoryRouter initialEntries={['/x']}><Routes>...</Routes></MemoryRouter>); expect(window.location.pathname).toBe('/x')` | Testa o React Router, não o seu código. Teste SUA rota: componente renderizado em `/x` |
| 10 | `fireEvent` onde `userEvent` existe | `fireEvent.change(input, { target: { value: 'x' } })` | `fireEvent` não simula eventos reais do usuário (foco, teclado, pointer); `userEvent` pega bugs de interação |

**Regra de bolso:** se o teste passa mesmo quando a feature é removida, é inútil. Se quebra sem revelar bug real, é inútil. Se duplica outro teste, é inútil.

### 4.2 Testes ÚTEIS — priorizar

| # | Tipo | Exemplo real |
|---|------|--------------|
| 1 | Regras de negócio visíveis | Cupom expirado → toast de erro; item esgotado → botão desabilitado; mínimo de itens → checkout bloqueado |
| 2 | Tratamento de erro de API | 404/500/timeout → mensagem de erro + estado de erro na tela (não tela branca) |
| 3 | Transições de estado | loading → sucesso → erro; carrinho vazio → com item → checkout habilitado |
| 4 | Fluxos críticos do usuário | Checkout completo multi-step (seção 2.5) |
| 5 | Navegação e restauração de estado | Voltar mantém filtros/carrinho (seção 2.2) |
| 6 | Transformação de dados | Formatar preço `R$ 19,90`, calcular desconto, frete grátis acima de R$ 100 |
| 7 | Security | Rota protegida sem token → redirect para login |

Exemplos de assert ÚTIL:
```tsx
// Regra de negócio visível
test('deveDesabilitarBotaoAdicionar_quandoItemEsgotado', () => {
  render(<MenuItem item={{ ...item, stock: 0 }} />);
  expect(screen.getByRole('button', { name: /adicionar ao carrinho/i })).toBeDisabled();
});

// Erro de API com estado visível
test('deveExibirMensagemDeErro_quandoApiRetorna500', async () => {
  getMenuMock.mockRejectedValue(new Error('Internal Server Error'));
  render(<MenuPage />);
  expect(await screen.findByText(/não foi possível carregar o cardápio/i)).toBeInTheDocument();
});

// Transformação de dados
test('deveCalcularFreteGratis_quandoTotalAcimaDe100', () => {
  expect(calculateShipping(120)).toBe(0);
  expect(calculateShipping(99.9)).toBe(7.9);
});
```

### 4.3 Exemplo completo — security com assert de rota
```tsx
test('deveRedirecionarParaLogin_quandoTokenAusente', async () => {
  useAuthStore.mockReturnValue({ token: null });
  renderWithRouter(<ProtectedPage />, { route: '/admin/orders' });

  expect(await screen.findByText(/faça login para continuar/i)).toBeInTheDocument();
  expect(window.location.pathname).toBe('/login');
});
```

---

## 5. Análise de Mutação Mental (Obrigatória)

Após escrever o teste, liste **3 formas** em que o teste passa mas o código ainda contém bug. Use como checklist de robustez.

### Exemplo: rota protegida
```tsx
test('deveRedirecionarParaLogin_quandoTokenExpirado', async () => {
  useAuthStore.mockReturnValue({ token: null });
  renderWithRouter(<ProtectedPage />, { route: '/protected' });
  expect(await screen.findByText(/faça login/i)).toBeInTheDocument();
});
```

**Mutações a considerar:**
1. Se o componente renderizasse a página mesmo sem token (mas mostrasse "faça login" como mensagem inline), o teste pegaria? → Adicionar assert de URL: `expect(window.location.pathname).toBe('/login')`.
2. Se `ProtectedPage` chamasse `navigate('/home')` em vez de `/login`, o teste pegaria? → Não. Assert de rota exata corrige.
3. Se o store retornasse `token: 'expirado'` (string) em vez de `null`, o teste pegaria? → Depende da validação; garantir que o mock reflete o cenário real de expiração.

### Exemplo: lista com estado de erro
```tsx
test('deveExibirLista_quandoApiRetornaItens', async () => {
  getMenuMock.mockResolvedValue({ data: [item1, item2] });
  render(<MenuPage />);
  expect(await screen.findByText(/pizza margherita/i)).toBeInTheDocument();
});
```

**Mutações a considerar:**
1. Se a página sempre renderizasse o primeiro item hardcoded (ignorando `getMenu`), o teste pegaria? → Não. Adicionar assert no segundo item.
2. Se a página nunca fizesse o fetch (lista vazia sem loading), o teste passaria? → Não, `findBy` falharia por timeout — mas assert de loading ajuda a diagnosticar.
3. Se o loading nunca sumisse, `findByText` com timeout estouraria? → Garantir que o assert espera o estado FINAL, não o intermediário.

---

## 6. Refinamento — Se o Código é Difícil de Testar, Refatore

Sinais de que o código precisa de refatoração antes do teste:

| Sintoma | Refatoração |
|---------|-------------|
| Componente com 500+ linhas | Extrair hooks customizados (`useX`) ou sub-componentes |
| Lógica de negócio dentro do componente | Mover para service/hook puro (ex: `calculateShipping` em `src/utils`) |
| `new Date()` hardcoded | Injetar via parâmetro ou hook `useNow()` mockável |
| Fetch direto no componente | Mover para API service (`menuService.ts`) |
| Múltiplos `if/else` aninhados | Extrair função pura com retorno explícito |
| Estado global (Zustand) acessado em 10 lugares | Isolar em hook que o teste pode mockar |

**Regra:** se você precisa de 15 linhas de mock para testar 3 linhas de código, o código está errado, não o teste. Teste a função pura extraída com 3 asserts diretos em vez do componente inteiro.

---

## 7. Checklist Pré-Commit (Frontend)

- [ ] Foca em comportamento (não implementação)
- [ ] Happy path + ≥2 edge cases + ≥1 error flow
- [ ] Mocks realistas (retornam estrutura idêntica à API real — mesmo shape do DTO)
- [ ] Asserts verificam o que importa (output visível/estado final), não só `toHaveBeenCalled`
- [ ] Testes independentes (sem ordem, estado do mock resetado em `beforeEach`)
- [ ] Nomes descritivos `deve[Resultado]_quando[Contexto]` e consistentes no arquivo
- [ ] Sem `setTimeout` para sincronizar (usar `findBy*` com timeout 10–15s)
- [ ] Sem `document.querySelector` / `fireEvent` onde `userEvent` existe / `toHaveClass` de Tailwind
- [ ] Sem teste inútil (seção 4.1): nada de framework test, circular mock, snapshot puro
- [ ] Fluxos de usuário reais onde aplicável (navegação, voltar, formulário, multi-step)
- [ ] Cobertura medida — ≥95% POR ARQUIVO (gate bloqueia abaixo)
- [ ] Análise de mutação mental executada (3 cenários listados)
- [ ] Código difícil de testar → refatoração sugerida/feita
- [ ] Nenhum assert de classe CSS / `console.log` / snapshot como único assert

---

## 8. Anti-Patterns Frontend (Proibidos)

| Anti-pattern | Por que é ruim | Correção |
|--------------|----------------|----------|
| Teste depende de `new Date()` sem mock | Quebra em datas específicas (ex: cupom expira hoje) | Injetar data via parâmetro ou `vi.useFakeTimers()` |
| Teste depende de rede externa (fetch real) | Flaky, lento, não-reproduzível | `vi.mock` no api service |
| `setTimeout` para sincronizar | Flaky, lento | `await screen.findBy*` com timeout 10–15s |
| `expect(mock).toHaveBeenCalled()` sem validar output | Não prova comportamento | Assert no resultado/estado visível (DOM, store, rota) |
| Mock retorna estrutura diferente da API real | Teste passa, production quebra | Usar factory de DTO realista (mesmo shape) |
| Snapshot como único assert | Não valida semântica | Snapshot + asserts semânticos, ou só asserts |
| `getByTestId` em tudo | Acopla teste a atributo artificial | `getByRole`/`getByLabelText`/`getByText` primeiro |
| `fireEvent` em interações comuns | Não simula foco/teclado reais | `userEvent.setup()` |
| Assert em `toHaveClass('bg-red-500')` | Testa CSS, não comportamento | Assert em disabled/hidden/texto |
| `as unknown as X` em mock | Esconde erros de tipo | Mock tipado corretamente com `Mock<typeof fn>` |
| Store real (sem `vi.mock`) em teste de página | Vaza estado entre testes, acopla | Factory de store mockada (seção 3.3) |

---

## 9. Exemplos de Referência

Use estes caminhos como referência de organização e qualidade (frontend):

- `src/pages/<modulo>/__tests__/<Pagina>.test.tsx` — checkout flow, multi-step, mock de store Zustand
- `src/pages/<modulo>/__tests__/<CrudPage>.test.tsx` — CRUD, formulário completo, happy path + error path
- `src/pages/<modulo>/__tests__/<ListPage>.test.tsx` — listagem, empty state, error state, loading

---

## 10. Comandos Canônicos

```bash
# Na raiz do repo
npm test                  # vitest run (CI)
npm run test:watch        # vitest watch (dev)
npm run test:coverage     # vitest run --coverage (cobertura por arquivo)
npm run test:e2e          # Playwright (E2E)
```

---

## 11. Qualidade e Cobertura

- **Gate (CI):** ≥95% POR ARQUIVO — abaixo disso, a transição dev → code-reviewer é bloqueada.
- **Meta:** ≥95% por arquivo em todo o frontend, priorizando código novo/alterado.
- **Cobertura não é tudo:** 100% de cobertura com asserts fracos é pior que 80% com asserts fortes (ver seção 4).
- **Priorize:** código novo/alterado deve ter cobertura proporcionalmente maior que código legado.
- **Meça sempre** (`npm run test:coverage`) antes de declarar funcionalidade pronta; reporte o número ao orquestrador.
- Se a medição não puder rodar, **pare e reporte o bloqueio** — não declare a funcionalidade pronta.

---

## 12. Fluxo de Trabalho Recomendado (TDD)

1. **RED** — escreva o teste falhando (define comportamento esperado: `deve[Resultado]_quando[Contexto]`).
2. **GREEN** — implemente o mínimo para o teste passar (não mais).
3. **REFACTOR** — limpe código mantendo teste verde (extraia hook/service se o teste ficar difícil).
4. **REPEAT** para próximo cenário (edge case, error flow — pirâmide da seção 1.2).
5. **Mutação mental** — liste 3 formas em que o teste pode passar com bug (seção 5).
6. **Cobertura** — meça com `npm run test:coverage`, garanta ≥95% POR ARQUIVO (gate bloqueia abaixo).

---

## Resumo Rápido

| Alvo | Stack | Isolamento | Assert |
|------|-------|------------|--------|
| Componente/página | Vitest + Testing Library + userEvent | `vi.mock` services/stores, `MemoryRouter`/`renderWithRouter` | `screen.getByRole`, `findBy*`, `toBeInTheDocument`, `toBeDisabled` |
| Hook | Vitest + `renderHook` | `vi.mock` stores/APIs | `result.current`, `await waitFor` |
| Store Zustand | Vitest | estado injetado manualmente (`useCartStore.setState` em store real ou factory mock) | estado pós-ação + efeito no componente |
| API service | Vitest + axios mock adapter / `vi.mock` do módulo | sem rede real | payload, headers, tratamento de erro |
| E2E (Playwright) | Playwright | app real em dev server | fluxo de usuário de ponta a ponta |
