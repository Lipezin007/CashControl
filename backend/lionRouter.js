const express = require("express");
const router = express.Router();
const OpenAI = require("openai");
const queries = require("./queries");
const pool = require("./db");

let _openai = null;
function getOpenAI() {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY não configurada no .env");
    }
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

// ===== TOOL DEFINITIONS =====

const TOOLS = [
  {
    type: "function",
    function: {
      name: "listar_transacoes",
      description: "Lista as transações financeiras do usuário em um mês específico",
      parameters: {
        type: "object",
        properties: {
          mes: { type: "string", description: "Mês no formato YYYY-MM, ex: 2025-06" }
        },
        required: ["mes"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "resumo_financeiro",
      description: "Retorna o resumo financeiro do mês: total de entradas, saídas, saldo do mês e saldo atual acumulado",
      parameters: {
        type: "object",
        properties: {
          mes: { type: "string", description: "Mês no formato YYYY-MM, ex: 2025-06" }
        },
        required: ["mes"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "criar_transacao",
      description: "Cria uma nova transação financeira (entrada ou saída) para o usuário",
      parameters: {
        type: "object",
        properties: {
          descricao: { type: "string", description: "Descrição da transação" },
          valor: { type: "number", description: "Valor em reais (positivo)" },
          tipo: { type: "string", enum: ["entrada", "saida"], description: "Tipo da transação" },
          data: { type: "string", description: "Data no formato YYYY-MM-DD" },
          categoria_id: { type: "number", description: "ID da categoria (use listar_categorias para obter)" }
        },
        required: ["descricao", "valor", "tipo", "data"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "editar_transacao",
      description: "Edita os dados de uma transação existente do usuário",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "ID da transação a editar" },
          descricao: { type: "string", description: "Nova descrição" },
          valor: { type: "number", description: "Novo valor em reais" },
          tipo: { type: "string", enum: ["entrada", "saida"] },
          data: { type: "string", description: "Nova data no formato YYYY-MM-DD" },
          categoria_id: { type: "number", description: "Novo ID da categoria" }
        },
        required: ["id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "deletar_transacao",
      description: "Remove uma transação. SEMPRE peça confirmação explícita ao usuário antes de passar confirmado=true",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "ID da transação a deletar" },
          confirmado: {
            type: "boolean",
            description: "true somente se o usuário confirmou explicitamente a exclusão nesta mesma conversa"
          }
        },
        required: ["id", "confirmado"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "listar_categorias",
      description: "Lista todas as categorias de transações disponíveis para o usuário",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "relatorio_por_categoria",
      description: "Retorna gastos e entradas agrupados por categoria em um mês",
      parameters: {
        type: "object",
        properties: {
          mes: { type: "string", description: "Mês no formato YYYY-MM" }
        },
        required: ["mes"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "listar_caixinhas",
      description: "Lista todas as caixinhas de poupança do usuário com saldo e rendimento atual",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "criar_caixinha",
      description: "Cria uma nova caixinha de poupança",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome da caixinha" },
          objetivo: { type: "number", description: "Valor objetivo em reais (opcional)" }
        },
        required: ["nome"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "movimentar_caixinha",
      description: "Deposita ou saca um valor de uma caixinha",
      parameters: {
        type: "object",
        properties: {
          caixinha_id: { type: "number", description: "ID da caixinha" },
          valor: { type: "number", description: "Valor a movimentar (positivo)" },
          tipo: { type: "string", enum: ["deposito", "saque"], description: "Tipo da movimentação" }
        },
        required: ["caixinha_id", "valor", "tipo"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "criar_meta",
      description: "Define uma meta de gastos para uma categoria em determinado mês",
      parameters: {
        type: "object",
        properties: {
          categoria_id: { type: "number", description: "ID da categoria" },
          valor_meta: { type: "number", description: "Valor limite de gastos em reais" },
          mes: { type: "string", description: "Mês no formato YYYY-MM" }
        },
        required: ["categoria_id", "valor_meta", "mes"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "listar_metas",
      description: "Lista as metas de gastos por categoria de um mês com o gasto atual",
      parameters: {
        type: "object",
        properties: {
          mes: { type: "string", description: "Mês no formato YYYY-MM" }
        },
        required: ["mes"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "listar_cartoes",
      description: "Lista os cartões de crédito cadastrados pelo usuário",
      parameters: { type: "object", properties: {}, required: [] }
    }
  }
];

// ===== TOOL EXECUTOR =====

async function executeTool(name, args, userId) {
  switch (name) {

    case "listar_transacoes":
      return await queries.getMovimentacoes(args.mes, userId);

    case "resumo_financeiro": {
      const resumo = await queries.getResumo(args.mes, userId);
      const saldoAtual = await queries.getSaldoAtual(userId);
      return {
        mes: args.mes,
        entradas: Number(resumo.entradas),
        saidas: Number(resumo.saidas),
        saldo_mes: Number(resumo.saldo),
        saldo_atual_acumulado: saldoAtual
      };
    }

    case "criar_transacao": {
      await pool.query(
        `INSERT INTO movimentacoes (descricao, valor, tipo, data, categoria_id, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [args.descricao, args.valor, args.tipo, args.data, args.categoria_id ?? null, userId]
      );
      return { ok: true, mensagem: `Transação "${args.descricao}" de R$ ${args.valor} criada com sucesso.` };
    }

    case "editar_transacao": {
      const existing = await pool.query(
        "SELECT * FROM movimentacoes WHERE id=$1 AND usuario_id=$2",
        [args.id, userId]
      );
      if (!existing.rows[0]) return { ok: false, erro: "Transação não encontrada" };
      const base = existing.rows[0];
      const result = await queries.editarMovimentacao(args.id, {
        descricao: args.descricao ?? base.descricao,
        valor: args.valor ?? base.valor,
        tipo: args.tipo ?? base.tipo,
        data: args.data ?? base.data,
        categoria_id: args.categoria_id !== undefined ? args.categoria_id : base.categoria_id,
        origem: base.origem
      }, userId);
      return { ok: result.changes > 0, mensagem: result.changes > 0 ? "Transação atualizada com sucesso." : "Nenhuma alteração feita." };
    }

    case "deletar_transacao":
      if (!args.confirmado) {
        return {
          ok: false,
          requer_confirmacao: true,
          mensagem: "Confirmação pendente. Informe ao usuário que precisa confirmar antes de deletar."
        };
      }
      const del = await queries.deletarMovimentacao(args.id, userId);
      return { ok: del.changes > 0, mensagem: del.changes > 0 ? "Transação removida com sucesso." : "Transação não encontrada." };

    case "listar_categorias":
      return await queries.getCategorias(userId);

    case "relatorio_por_categoria":
      return await queries.getRelatorioCategorias(args.mes, userId);

    case "listar_caixinhas":
      return (await queries.getCaixinhas(userId)).map(c => ({
        id: c.id,
        nome: c.nome,
        saldo: Number(c.saldo || 0),
        saldo_atualizado: c.saldo_atualizado,
        objetivo: c.objetivo,
        rendimento_estimado: c.rendimento_estimado
      }));

    case "criar_caixinha": {
      const nova = await queries.addCaixinha(
        userId, args.nome, args.objetivo ?? null,
        null, null, null, null, false
      );
      return { ok: true, id: nova.id, mensagem: `Caixinha "${args.nome}" criada com sucesso.` };
    }

    case "movimentar_caixinha":
      return await queries.movimentarCaixinha(
        args.caixinha_id, userId, args.valor, args.tipo,
        new Date().toISOString().slice(0, 10)
      );

    case "criar_meta":
      await queries.setMetaCategoria(userId, args.categoria_id, args.valor_meta, args.mes);
      return { ok: true, mensagem: `Meta de R$ ${args.valor_meta} definida para o mês ${args.mes}.` };

    case "listar_metas":
      return await queries.getMetasComGasto(args.mes, userId);

    case "listar_cartoes":
      return await queries.getCartoes(userId);

    default:
      return { erro: `Ferramenta desconhecida: ${name}` };
  }
}

// ===== SYSTEM PROMPT =====

const SYSTEM_PROMPT = `Você é o Lion, assistente financeiro pessoal integrado ao CashControl.

Você pode consultar dados do usuário e executar ações reais como criar, editar e remover transações, gerenciar caixinhas e metas.

Diretrizes:
- Responda sempre em português brasileiro, de forma objetiva e amigável
- Use as ferramentas disponíveis para buscar dados reais antes de responder sobre finanças
- Para EXCLUSÕES: nunca execute sem confirmação explícita do usuário nesta mensagem. Primeiro pergunte "Tem certeza que deseja deletar X?", e só execute com confirmado=true quando o usuário disser "sim" ou "pode deletar"
- Para criar/editar dados, confirme o que foi feito com um resumo claro
- Formate valores como R$ 1.234,56
- Ao listar transações, agrupe e formate de forma legível
- O mês atual é ${new Date().toISOString().slice(0, 7)}
- Seja proativo: se o usuário perguntar sobre gastos, consulte o resumo e o relatório por categoria para dar uma análise completa`;

// ===== ROUTE =====

router.post("/chat", async (req, res) => {
  const userId = req.user.id;
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ erro: "messages é obrigatório e deve ser um array" });
  }

  // Aceita apenas role/content para evitar injeção de mensagens de sistema pelo cliente
  const safeMessages = messages
    .filter(m => ["user", "assistant"].includes(m.role))
    .map(m => ({ role: m.role, content: String(m.content || "") }));

  if (safeMessages.length === 0) {
    return res.status(400).json({ erro: "Nenhuma mensagem válida encontrada" });
  }

  try {
    const chatMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...safeMessages
    ];

    const openai = getOpenAI();

    let response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: chatMessages,
      tools: TOOLS,
      tool_choice: "auto",
      max_tokens: 1200,
      temperature: 0.4
    });

    let choice = response.choices[0];
    let iterations = 0;
    const MAX_ITERATIONS = 6;

    // Loop agêntico: executa tools até não haver mais chamadas pendentes
    while (choice.finish_reason === "tool_calls" && iterations < MAX_ITERATIONS) {
      iterations++;
      const toolCalls = choice.message.tool_calls;
      chatMessages.push(choice.message);

      for (const tc of toolCalls) {
        let toolResult;
        try {
          const args = JSON.parse(tc.function.arguments);
          toolResult = await executeTool(tc.function.name, args, userId);
        } catch (err) {
          toolResult = { erro: `Falha ao executar ${tc.function.name}: ${err.message}` };
        }

        chatMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(toolResult)
        });
      }

      response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: chatMessages,
        tools: TOOLS,
        tool_choice: "auto",
        max_tokens: 1200,
        temperature: 0.4
      });

      choice = response.choices[0];
    }

    res.json({ resposta: choice.message.content });
  } catch (err) {
    console.error("[Lion] Erro:", err.message);
    if (err.status === 401) {
      return res.status(500).json({ erro: "Chave da OpenAI inválida ou não configurada." });
    }
    res.status(500).json({ erro: "Falha ao processar mensagem." });
  }
});

module.exports = router;
