# Guia Completo — Usar com Ollama (Local e Cloud)

O Ollama permite rodar modelos de IA abertos localmente ou usar modelos na nuvem. Este guia explica tudo.

---

## Parte 1: Execução 100% Local

### Pré-requisitos

1. **Node.js (obrigatório):** A ferramenta "Buscador Sem Filtro" é um app web. Para abrir localmente sem erros de CORS e garantir que tudo funcione (especialmente a comunicação com o Ollama local), você precisa rodar um servidor HTTP local.
   - Baixe e instale em: [https://nodejs.org](https://nodejs.org) (escolha a versão LTS)
   - Após instalar, teste no terminal: `node --version`

2. **Ollama instalado:** Baixe em [https://ollama.com/download](https://ollama.com/download) e instale normalmente.

### Passo a Passo

**1. Inicie o servidor local do Buscador Sem Filtro:**
   ```bash
   # Na pasta do projeto, execute:
   npx serve .
   ```
   - Acesse: `http://localhost:3000`
   - *Nota:* Se a porta 3000 estiver ocupada, use `npx serve . -l 8080` e acesse `http://localhost:8080`

**2. Inicie o servidor do Ollama:**
   ```bash
   # Abra outro terminal e digite:
   ollama serve
   ```
   - Mantenha este terminal aberto (minimize se preferir)
   - No Windows, o ícone do Ollama na bandeja do sistema (ao lado do relógio) também mantém o serviço rodando

**3. Baixe um modelo (exemplo com Llama 3.3):**
   ```bash
   # Abra um NOVO terminal (terceiro) e digite:
   ollama pull llama3.3
   ```

**4. Configure no Buscador Sem Filtro:**
   - Vá em **Configurações** (ícone de engrenagem ⚙️)
   - Selecione **Ollama (Local)** como provedor de IA
   - O campo "URL do Servidor Ollama" já vem preenchido com `http://localhost:11434`
   - O app vai detectar automaticamente os modelos instalados na sua máquina
   - Escolha o modelo desejado e clique **Salvar Chaves**

---

### Modelos Recomendados por Quantidade de RAM

| RAM Disponível | Modelos Recomendados | Tamanho |
|---|---|---|
| 4 GB | `llama3.2:1b`, `qwen2.5:0.5b`, `phi4:2.7b` | 1-3 GB |
| 6 GB | `llama3.2:3b`, `qwen2.5:3b`, `deepseek-r1:7b` | 3-7 GB |
| 8 GB | `llama3.2:3b`, `qwen2.5:7b`, `mistral` | 4-8 GB |
| 12+ GB | `llama3.3`, `qwen2.5:14b`, `gemma3:12b` | 8-15 GB |

**Exemplos de comando para baixar:**
```bash
ollama pull llama3.2:1b      # ~1.3GB — funciona em qualquer PC
ollama pull qwen2.5:3b        # ~2GB — muito rápido
ollama pull deepseek-r1:7b   # ~4.7GB — excelente qualidade
ollama pull llama3.3           # ~8GB — requer 8GB+ de RAM
```

> **Sobre o erro "model requires more system memory (18.5 GiB) than is available (5.6 GiB)":**
> Isso se refere à **memória RAM** do seu computador (não HD). Significa que o modelo escolhido exige mais RAM do que você tem disponível.
> **Solução:** Escolha um modelo menor (veja a tabela acima). Para 6GB de RAM,use `deepseek-r1:7b` ou `qwen2.5:3b`.

---

## Parte 2: Ollama Cloud

O Ollama Cloud permite usar modelos potentes sem ocupar sua RAM.

**Para usar:**
1. Gere uma chave de API em [https://ollama.com/cloud](https://ollama.com/cloud)
2. No Buscador Sem Filtro, selecione **Ollama (Cloud)** como provedor
3. Cole sua API Key e clique **Salvar**
4. Escolha o modelo na lista e use normalmente

*Nota: O Ollama Cloud é um serviço pago/beta. Alguns modelos requerem crédito ou convite.*

---

## Parte 3: Solução de Problemas

| Erro | Causa | Solução |
|---|---|---|
| `Failed to load resource: 404` | Ollama Serve não está rodando | Execute `ollama serve` em outro terminal |
| `model not found` | Modelo não foi baixado | Execute `ollama pull [nome-do-modelo]` |
| `requires more system memory` | RAM insuficiente | Escolha um modelo menor na tabela acima |
| `Could not connect` | CORS ou URL errada | Use `npx serve .` para abrir o app, não `file://` |

---

## Lista de Modelos Populares (Comando para Baixar)

```bash
ollama pull llama3.2:1b      # Recurso, funciona em qualquer PC
ollama pull qwen2.5:3b        # Equilibrado, boa qualidade
ollama pull deepseek-r1:7b   # Excepcional para raciocínio
ollama pull llama3.3           # Melhor qualidade geral (requer 8GB+)
ollama pull gemma3:12b        # multimodal (imagens + texto)
```
