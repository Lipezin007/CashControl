const lista = document.querySelector("#lista");
const form = document.querySelector("#form");
const resumoDiv = document.querySelector("#resumo");
const metaCategoria = document.querySelector("#meta_categoria");
const metaValor = document.querySelector("#meta_valor");
const btnMeta = document.querySelector("#btnMeta");
const fatCartao = document.querySelector("#fat_cartao");
const fatMes = document.querySelector("#fat_mes");
const btnFat = document.querySelector("#btnFat");
const fatTotal = document.querySelector("#fat_total");
const fatItens = document.querySelector("#fat_itens");
const metasBody = document.querySelector("#metasBody");
const categoriaSelect = document.querySelector("#categoria");
const formCaixinha = document.querySelector("#formCaixinha");
const listaCaixinhas = document.querySelector("#listaCaixinhas");
const caixinhaIdInput = document.querySelector("#caixinhaId");
const caixinhaNomeInput = document.querySelector("#caixinhaNome");
const caixinhaObjetivoInput = document.querySelector("#caixinhaObjetivo");
const caixinhaRendimentoTipoInput = document.querySelector("#caixinhaRendimentoTipo");
const caixinhaRendimentoPercentualInput = document.querySelector("#caixinhaRendimentoPercentual");
const caixinhaInstituicaoInput = document.querySelector("#caixinhaInstituicao");
const caixinhaProdutoInput = document.querySelector("#caixinhaProduto");
const caixinhaAutoPercentualInput = document.querySelector("#caixinhaAutoPercentual");
const btnSyncRendimento = document.querySelector("#btnSyncRendimento");

const filtroMes = document.querySelector("#filtroMes");

const chartMensalCanvas = document.querySelector("#chartMensal");
const chartCaixinhasCanvas = document.querySelector("#chartCaixinhas");
const caixinhaPeriodoSelect = document.querySelector("#caixinhaPeriodo");
const idInput = document.querySelector("#id");
const descricaoInput = document.querySelector("#descricao");
const valorInput = document.querySelector("#valor");
const tipoInput = document.querySelector("#tipo");
const origemInput = document.querySelector("#origem");
const dataInput = document.querySelector("#data");

const cartaoSelect = document.querySelector("#cartaoSelect");
const parcelasInput = document.querySelector("#parcelasInput");
const jurosInput = document.querySelector("#jurosInput");
let chartMensal = null;
let chartDiario = null;
let chartCaixinhas = null;
const chartAnimationOptions = false;


function mesAtualYYYYMM() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
}

if (filtroMes && !filtroMes.value) {
    filtroMes.value = mesAtualYYYYMM();
}

// Atualiza grÃ¡ficos ao alterar o mÃªs
filtroMes?.addEventListener("change", async () => {
    if (typeof refreshTudo === "function") {
        await refreshTudo();
    }
});

const areaCartao = document.querySelector("#areaCartao");

const token =
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");

if (!token) {
    window.location.href = "/login.html";
}

async function api(url, options = {}) {

    const headers = {
        ...(options.headers || {}),
        "Authorization": "Bearer " + token
    };

    const response = await fetch(url, {
        ...options,
        headers
    });

    if (!response.ok) {
        const text = await response.text();
        console.error("Erro API:", text);
        throw new Error(text);
    }

    return response;
}

function ajustarTipoCartao() {

    if (!origemInput || !tipoInput) return;

    if (origemInput.value === "cartao_credito") {
        tipoInput.value = "saida";
        tipoInput.disabled = true;
    } else {
        tipoInput.disabled = false;
    }
}

async function carregarGraficoMensal() {
    if (!chartMensalCanvas) return;

    const ano = new Date().getFullYear();

    const dados = await api(`/api/mensal?ano=${ano}`).then(r => r.json());

    const labels = dados.map(x => x.mes);
    const entradas = dados.map(x => Number(x.entradas || 0));
    const saidas = dados.map(x => Number(x.saidas || 0));
    const saldo = entradas.map((v, i) => v - saidas[i]);

    if (chartMensal) chartMensal.destroy();

    chartMensal = new Chart(chartMensalCanvas, {
        type: "line",
        data: {
            labels,
            datasets: [{
                    label: "Entradas",
                    data: entradas,
                    borderColor: "#22c55e",
                    backgroundColor: "rgba(34,197,94,0.2)",
                    tension: 0.3
                },
                {
                    label: "SaÃ­das",
                    data: saidas,
                    borderColor: "#ef4444",
                    backgroundColor: "rgba(239,68,68,0.2)",
                    tension: 0.3
                },
                {
                    label: "Saldo",
                    data: saldo,
                    borderColor: "#00e5ff",
                    backgroundColor: "rgba(0,229,255,0.2)",
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            animation: chartAnimationOptions,
            plugins: {
                legend: { position: "top" }
            }
        }
    });
}

function corLinhaPorIndice(i) {
    const hue = (i * 67) % 360;
    return {
        borda: `hsl(${hue}, 88%, 62%)`,
        fundo: `hsla(${hue}, 88%, 62%, 0.16)`
    };
}

async function carregarGraficoCaixinhas() {
    if (!chartCaixinhasCanvas) return;

    const periodo = caixinhaPeriodoSelect?.value || "mensal";
    const dadosResp = await api(`/api/caixinhas/evolucao?periodo=${encodeURIComponent(periodo)}`).then(r => r.json());
    let dados = Array.isArray(dadosResp) ? dadosResp : [];

    // Fallback: se nao houver historico agregado, usa snapshot atual das caixinhas.
    if (!dados.length) {
        const caixinhas = await api("/api/caixinhas").then(r => r.json());
        const rotuloAtual = "Atual";

        dados = (Array.isArray(caixinhas) ? caixinhas : []).map((c) => ({
            caixinha_id: c.id,
            caixinha_nome: c.nome,
            periodo: rotuloAtual,
            saldo_acumulado: Number(c.saldo_atualizado ?? c.saldo ?? 0)
        }));
    }

    if (chartCaixinhas) chartCaixinhas.destroy();

    const dadosOrdenados = [...dados].sort((a, b) => {
        const ia = Number.isFinite(Number(a.bucket_idx)) ? Number(a.bucket_idx) : 999;
        const ib = Number.isFinite(Number(b.bucket_idx)) ? Number(b.bucket_idx) : 999;
        if (ia !== ib) return ia - ib;
        return String(a.periodo).localeCompare(String(b.periodo));
    });

    const labels = [...new Set(dadosOrdenados.map(d => d.periodo))];
    const porCaixinha = new Map();

    for (const item of dadosOrdenados) {
        const id = Number(item.caixinha_id);
        const nome = item.caixinha_nome || `Caixinha ${id}`;

        if (!porCaixinha.has(id)) {
            porCaixinha.set(id, { id, nome, mapa: new Map() });
        }

        porCaixinha.get(id).mapa.set(item.periodo, Number(item.saldo_acumulado || 0));
    }

    const datasets = [...porCaixinha.values()].map((cx, index) => {
        const cor = corLinhaPorIndice(index);
        let saldoAtual = 0;

        const serie = labels.map((lbl) => {
            if (cx.mapa.has(lbl)) {
                saldoAtual = Number(cx.mapa.get(lbl) || 0);
            }
            return Number(saldoAtual.toFixed(2));
        });

        return {
            label: cx.nome,
            data: serie,
            borderColor: cor.borda,
            backgroundColor: cor.fundo,
            borderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 4,
            tension: 0.25
        };
    });

    if (!datasets.length) {
        if (chartCaixinhas) {
            chartCaixinhas.destroy();
            chartCaixinhas = null;
        }
        return;
    }

    chartCaixinhas = new Chart(chartCaixinhasCanvas, {
        type: "line",
        data: {
            labels,
            datasets
        },
        options: {
            responsive: true,
            animation: chartAnimationOptions,
            interaction: {
                mode: "nearest",
                axis: "x",
                intersect: false
            },
            plugins: {
                legend: {
                    position: "top",
                    labels: { color: "#fff" }
                }
            },
            scales: {
                x: {
                    ticks: { color: "#aaa" }
                },
                y: {
                    ticks: {
                        color: "#aaa",
                        callback: (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                    }
                }
            }
        }
    });
}

caixinhaPeriodoSelect?.addEventListener("change", async () => {
    await carregarGraficoCaixinhas();
});

origemInput?.addEventListener("change", ajustarTipoCartao);
ajustarTipoCartao();

function toggleCartaoUI() {
    if (!origemInput || !areaCartao) return;

    if (origemInput.value === "cartao_credito") {
        areaCartao.classList.add("mostrar");
    } else {
        areaCartao.classList.remove("mostrar");
    }
}
origemInput?.addEventListener("change", toggleCartaoUI);
toggleCartaoUI();

if (dataInput) {
    dataInput.valueAsDate = new Date();
}

async function carregarCartoesNoForm() {
    if (!cartaoSelect) return;

    const cartoes = await api("/api/cartoes").then(r => r.json());

    cartaoSelect.innerHTML =
        `<option value="">Selecione o cartÃ£o</option>` +
        cartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join("");
}

const dashboardDiv = document.querySelector("#dashboard");

async function carregarDashboard() {

    const mes = filtroMes.value;

    const d = await api(`/api/dashboard?mes=${mes}`).then(r => r.json());

    dashboardDiv.innerHTML = `
    <p><b>Saldo atual:</b> ${money(d.saldo)}</p>
    <p><b>Entradas do mÃªs:</b> ${money(d.entradas)}</p>
    <p><b>SaÃ­das do mÃªs:</b> ${money(d.saidas)}</p>
    <p><b>Fatura do cartÃ£o:</b> ${money(d.fatura)}</p>
  `;
}

// MOSTRAR / ESCONDER AREA DE CARTÃƒO
// executa quando mudar o select
if (origemInput) {
    origemInput?.addEventListener("change", toggleCartaoUI);
}

// executa quando abrir a pÃ¡gina
toggleCartaoUI();
origemInput?.addEventListener("change", toggleCartaoUI);
toggleCartaoUI(); // jÃ¡ aplica ao abrir a pÃ¡gina

if (dataInput) {
    dataInput.valueAsDate = new Date();
}

async function carregarRelatorioCategorias() {
    if (!metasBody) return;

    const mes = (filtroMes && filtroMes.value) ? filtroMes.value : null;
    if (!mes) { metasBody.innerHTML = ""; return; }

    const dados = await api(`/api/relatorio-categorias?mes=${encodeURIComponent(mes)}`).then(r => r.json());

    metasBody.innerHTML = dados.map(x => {

        const perc = x.meta > 0 ?
            ((x.total_saidas / x.meta) * 100).toFixed(0) :
            0;

        const alerta = perc >= 100 ? "âš " : "";

        return `
      <tr>
        <td>${x.categoria}</td>
        <td>${money(x.total_saidas)}</td>
        <td>${money(x.total_entradas)}</td>
        <td>${money(x.meta)}</td>
        <td>${perc}% ${alerta}</td>
      </tr>
    `;

    }).join("");
}

function money(v) {
    return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function modalUI(options) {
    if (typeof abrirModal === "function") {
        return abrirModal(options);
    }

    // Evita usar alert/confirm/prompt nativo mesmo se o modal ainda nao estiver pronto.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (typeof abrirModal === "function") {
        return abrirModal(options);
    }

    console.warn("Modal padrao ainda nao foi inicializado.");
    return options.input ? false : !options.mostrarCancelar;
}

async function modalConfirmar(titulo, texto, confirmarTexto = "OK") {
    const r = await modalUI({
        titulo,
        texto,
        mostrarCancelar: true,
        confirmarTexto
    });
    return !!r;
}

async function modalAviso(titulo, texto) {
    await modalUI({
        titulo,
        texto,
        mostrarCancelar: false,
        fecharAoClicarFora: true
    });
}

async function modalInput(titulo, texto, confirmarTexto = "Confirmar") {
    const r = await modalUI({
        titulo,
        texto,
        input: true,
        confirmarTexto
    });

    if (r === false) return null;
    return r;
}

function getCaixinhaIcone(nome = "") {
    const n = String(nome).toLowerCase();
    if (n.includes("viagem") || n.includes("ferias")) return "âœˆ";
    if (n.includes("carro") || n.includes("moto")) return "ðŸš—";
    if (n.includes("casa") || n.includes("apart")) return "ðŸ ";
    if (n.includes("estudo") || n.includes("curso")) return "ðŸ“š";
    if (n.includes("emerg") || n.includes("reserva")) return "ðŸ›Ÿ";
    return "ðŸ’°";
}

function getClasseProgresso(perc) {
    if (perc >= 100) return "alta";
    if (perc >= 60) return "media";
    return "baixa";
}

function resetFormCaixinha() {
    if (!formCaixinha) return;

    formCaixinha.reset();
    if (caixinhaIdInput) caixinhaIdInput.value = "";
    if (caixinhaRendimentoTipoInput && !caixinhaRendimentoTipoInput.value) {
        caixinhaRendimentoTipoInput.value = "CDI";
    }
    if (caixinhaRendimentoPercentualInput && !caixinhaRendimentoPercentualInput.value) {
        caixinhaRendimentoPercentualInput.value = "100";
    }
    if (caixinhaProdutoInput && !caixinhaProdutoInput.value) {
        caixinhaProdutoInput.value = "Conta";
    }
    if (caixinhaAutoPercentualInput) {
        caixinhaAutoPercentualInput.checked = false;
    }
}

async function carregarCaixinhas() {
    if (!listaCaixinhas) return;

    const caixinhas = await api("/api/caixinhas").then(r => r.json());

    if (!Array.isArray(caixinhas) || !caixinhas.length) {
        listaCaixinhas.innerHTML = `
      <div class="caixinha-empty">
        Nenhuma caixinha criada ainda. Crie a primeira para separar seus objetivos.
      </div>
    `;
        return;
    }

    listaCaixinhas.innerHTML = caixinhas.map(c => {
                const saldo = Number(c.saldo || 0);
                const saldoAtualizado = Number(c.saldo_atualizado || saldo);
                const rendimento = Number(c.rendimento_estimado || 0);
                const objetivo = Number(c.objetivo || 0);
                const progresso = objetivo > 0 ? Math.min(100, (saldoAtualizado / objetivo) * 100) : 0;
                const classeProgresso = getClasseProgresso(progresso);
                const icone = getCaixinhaIcone(c.nome);

                return `
      <article class="caixinha-card">
        <div class="caixinha-topo">
          <h3><span class="caixinha-icone">${icone}</span> ${c.nome}</h3>
          <span class="caixinha-tag">${c.rendimento_tipo || "Sem Ã­ndice"}</span>
        </div>

        <p><b>Saldo:</b> ${money(saldoAtualizado)}</p>
        <p><b>Base:</b> ${money(saldo)}</p>
        <p><b>Rendimento simulado:</b> ${money(rendimento)} em ${Number(c.dias_rendimento || 0)} dias</p>
        <p><b>Taxa aplicada:</b> ${Number(c.percentual_aplicado || 0).toFixed(2)}% do ${c.rendimento_tipo || "Ã­ndice"} (${c.percentual_origem === "automatico" ? "auto" : "manual"})</p>
        <p><b>InstituiÃ§Ã£o:</b> ${c.instituicao || "-"} ${c.produto ? `(${c.produto})` : ""}</p>
        <p><b>Meta:</b> ${objetivo > 0 ? money(objetivo) : "NÃ£o definida"}</p>

        ${objetivo > 0 ? `
          <div class="caixinha-progresso ${classeProgresso}">
            <div class="caixinha-progresso-barra" style="width:${progresso.toFixed(1)}%"></div>
          </div>
          <small>${progresso.toFixed(0)}% da meta</small>
        ` : ""}

        <div class="caixinha-acoes">
          <button data-cx-action="deposito" data-id="${c.id}">Depositar</button>
          <button data-cx-action="saque" data-id="${c.id}">Sacar</button>
          <button data-cx-action="editar" data-id="${c.id}">Editar</button>
          <button data-cx-action="excluir" data-id="${c.id}">Excluir</button>
        </div>
      </article>
    `;
  }).join("");
}

async function carregarCategorias() {
  const cats = await api("/api/categorias").then(r => r.json());
console.log("CATEGORIAS:", cats);

  categoriaSelect.innerHTML = cats.map(c =>
    `<option value="${c.id}">${c.nome}</option>`
  ).join("");
}

filtroMes?.addEventListener("input", async () => {
  await refreshTudo();
});

async function carregarTransacoes() {
  if (!filtroMes?.value) return;

  const url = `/api/movimentacoes?mes=${encodeURIComponent(filtroMes.value)}`;
  const trans = await api(url).then(r => r.json());

  lista.innerHTML = trans.map(t => `
    <tr>
      <td class="col-data">${t.data}</td>
      <td class="col-descricao">
      ${t.parcela_num ? `${t.descricao} (${t.parcela_num}/${t.parcela_total})` : t  .descricao}
      </td>
      <td class="col-categoria">${t.categoria ?? "-"}</td>
      <td class="col-tipo">${t.tipo}</td>
      <td class="col-valor">${money(t.valor)}</td>
      <td class="col-acoes">
        <div class="acoes-inline">
          <button data-action="edit" data-id="${t.id}">Editar</button>
          <button data-action="del" data-id="${t.id}">Excluir</button>
        </div>
      </td>
    </tr>
  `).join("");
}

// DelegaÃ§Ã£o de eventos pros botÃµes da tabela
lista?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const action = btn.dataset.action;
  const id = Number(btn.dataset.id);

  if (action === "del") {
    const ok = await modalConfirmar("Excluir transaÃ§Ã£o", "Excluir essa transaÃ§Ã£o?", "Excluir");
    if (!ok) return;
    await api(`/api/movimentacoes/${id}`, { method: "DELETE" });
    await refreshTudo();
    return;
  }

  if (action === "edit") {
    // pega a transaÃ§Ã£o atual pra preencher o form
    const trans = await api(`/api/movimentacoes?mes=${encodeURIComponent(filtroMes.value)}`).then(r=>r.json());
    const t = trans.find(x => x.id === id);
    if (!t) return;

    idInput.value = t.id;
    descricaoInput.value = t.descricao;
    valorInput.value = t.valor;
    tipoInput.value = t.tipo;
    dataInput.value = t.data;

    // tenta selecionar categoria
    if (t.categoria_id) categoriaSelect.value = t.categoria_id;

    // dica visual: levar pro topo/form
    descricaoInput.focus();
  }
});

form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  console.log("SUBMIT DISPAROU");
const cartaoSelect = document.querySelector("#cartaoSelect");
const parcelasInput = document.querySelector("#parcelasInput");
const jurosInput = document.querySelector("#jurosInput");
const isCartao = origemInput.value === "cartao_credito";

console.log("origem:", origemInput.value);
console.log("isCartao:", isCartao);

const body = {
  descricao: descricaoInput.value,
  valor: Number(valorInput.value),
  tipo: tipoInput.value,
  origem: origemInput.value,
  categoria_id: Number(categoriaSelect.value),
  data: dataInput.value,

  cartao_id: isCartao ? Number(cartaoSelect.value) : null,
  parcelas: isCartao ? Number(parcelasInput.value || 1) : 1,
  juros_mensal: isCartao ? Number(jurosInput.value || 0) : 0
};

  const id = idInput.value ? Number(idInput.value) : null;

  if (id) {

  await api(`/api/movimentacoes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

} else {

  if (origemInput.value === "cartao_credito") {

    const compraCartao = {
      descricao: descricaoInput.value,
      valor_total: Number(valorInput.value),
      categoria_id: Number(categoriaSelect.value),
      cartao_id: Number(cartaoSelect.value),
      parcelas: Number(parcelasInput.value || 1),
      juros_mensal: Number(jurosInput.value || 0),
      data_compra: dataInput.value
};

    await api("/api/cartoes/compra", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(compraCartao)
    });

  } else {

    await api("/api/movimentacoes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

  }

}

  // limpa form e recarrega
  form.reset();
  idInput.value = "";
  if (dataInput) {
  dataInput.valueAsDate = new Date();
}

  await refreshTudo();
});

formCaixinha?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const body = {
    nome: caixinhaNomeInput.value,
    objetivo: caixinhaObjetivoInput.value ? Number(caixinhaObjetivoInput.value) : null,
    rendimento_tipo: caixinhaRendimentoTipoInput.value,
    rendimento_percentual: Number(caixinhaRendimentoPercentualInput.value || 0),
    instituicao: caixinhaInstituicaoInput.value,
    produto: caixinhaProdutoInput.value,
    auto_percentual: !!caixinhaAutoPercentualInput.checked
  };

  const id = caixinhaIdInput.value ? Number(caixinhaIdInput.value) : null;

  if (id) {
    await api(`/api/caixinhas/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } else {
    await api("/api/caixinhas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  resetFormCaixinha();
  await carregarCaixinhas();
});

listaCaixinhas?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-cx-action]");
  if (!btn) return;

  const action = btn.dataset.cxAction;
  const id = Number(btn.dataset.id);

  if (!id) return;

  if (action === "deposito" || action === "saque") {
    let valor = null;

    const entrada = await modalInput(
      action === "deposito" ? "Depositar na caixinha" : "Sacar da caixinha",
      "Informe o valor da movimentaÃ§Ã£o",
      "Confirmar"
    );
    valor = entrada == null ? null : Number(String(entrada).replace(",", "."));

    if (!valor || !Number.isFinite(valor) || valor <= 0) return;

    try {
      await api(`/api/caixinhas/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valor })
      });

      // Atualiza tambÃ©m o saldo/resumo da conta principal apÃ³s transferÃªncia.
      await refreshTudo();
    } catch (err) {
      const msg = String(err.message || "");
      await modalAviso("NÃ£o foi possÃ­vel concluir", msg || "Erro ao movimentar caixinha.");
    }

    return;
  }

  if (action === "editar") {
    const caixinhas = await api("/api/caixinhas").then(r => r.json());
    const c = caixinhas.find(x => Number(x.id) === id);
    if (!c) return;

    caixinhaIdInput.value = String(c.id);
    caixinhaNomeInput.value = c.nome || "";
    caixinhaObjetivoInput.value = c.objetivo ?? "";
    caixinhaRendimentoTipoInput.value = c.rendimento_tipo || "CDI";
    caixinhaRendimentoPercentualInput.value = Number(c.rendimento_percentual || 100);
    caixinhaInstituicaoInput.value = c.instituicao || "";
    caixinhaProdutoInput.value = c.produto || "Conta";
    caixinhaAutoPercentualInput.checked = Number(c.auto_percentual || 0) === 1;
    caixinhaNomeInput.focus();
    return;
  }

  if (action === "excluir") {
    const confirmar = await modalConfirmar(
      "Excluir caixinha",
      "Deseja excluir a caixinha e todas as movimentaÃ§Ãµes?",
      "Excluir"
    );

    if (!confirmar) return;

    await api(`/api/caixinhas/${id}`, { method: "DELETE" });
    await carregarCaixinhas();
    resetFormCaixinha();
  }
});

btnSyncRendimento?.addEventListener("click", async () => {
  await api("/api/rendimento/atualizar", { method: "POST" });
  await carregarCaixinhas();

  if (typeof abrirModal === "function") {
    await abrirModal({
      titulo: "Taxas atualizadas",
      texto: "CDI e taxas de instituiÃ§Ãµes foram sincronizados.",
      mostrarCancelar: false,
      fecharAoClicarFora: true
    });
  }
});

(async function init() {

  if (filtroMes && !filtroMes.value) {
    filtroMes.value = mesAtualYYYYMM();
  }

  await carregarCategorias();
  await carregarCartoesNoForm();
  await carregarCategoriasMeta();

  await refreshTudo();
  await carregarCaixinhas();
  resetFormCaixinha();

})();
// ====== RECORRÃŠNCIAS (visualizaÃ§Ã£o/teste) ======
const formRec = document.querySelector("#formRec");
const listaRec = document.querySelector("#listaRec");
const rDesc = document.querySelector("#r_descricao");
const rValor = document.querySelector("#r_valor");
const rTipo = document.querySelector("#r_tipo");
const rCat = document.querySelector("#r_categoria");
const rDia = document.querySelector("#r_dia");
const rId = document.querySelector("#r_id");
const rAtivo = document.querySelector("#r_ativo");
const rMes = document.querySelector("#r_mes");
const btnGerar = document.querySelector("#btnGerar");
const resumoRec = document.querySelector("#resumoRec");

if (rMes) rMes.value = mesAtualYYYYMM();

async function carregarCategoriasRec() {
  const cats = await api("/api/categorias").then(r => r.json());
  rCat.innerHTML = cats.map(c => `<option value="${c.id}">${c.nome}</option>`).join("");
}

async function carregarResumoRecorrencias() {
  if (!resumoRec) return;
  const r = await api("/api/recorrencias/resumo").then(x => x.json());
  resumoRec.innerHTML = `
    <b>SÃ³ recorrÃªncias ativas:</b>
    Entradas ${money(r.entradas)} | SaÃ­das ${money(r.saidas)} | Saldo ${money(r.saldo)}
  `;
}

async function carregarRecorrencias() {
  const recs = await api("/api/recorrencias").then(r => r.json());
  listaRec.innerHTML = recs.map(r => `
    <tr>
      <td>${r.dia_mes}</td>
      <td>${r.descricao}</td>
      <td>${r.categoria ?? "-"}</td>
      <td>${r.tipo}</td>
      <td>${money(r.valor)}</td>
      <td>${r.ativo ? "Sim" : "NÃ£o"}</td>
      <td>
        <button data-ra="edit" data-id="${r.id}">Editar</button>
        <button data-ra="del" data-id="${r.id}">Excluir</button>
      </td>
    </tr>
  `).join("");

  await carregarResumoRecorrencias();
}

formRec?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const body = {
    descricao: rDesc.value,
    valor: Number(rValor.value),
    tipo: rTipo.value,
    categoria_id: Number(rCat.value),
    dia_mes: Number(rDia.value),
    ativo: rAtivo.checked
  };

  const id = rId.value ? Number(rId.value) : null;

  if (id) {
    await api(`/api/recorrencias/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } else {
    await api("/api/recorrencias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  formRec.reset();
  rId.value = "";
  rAtivo.checked = true;
  await carregarRecorrencias();
});

listaRec?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const action = btn.dataset.ra;
  const id = Number(btn.dataset.id);

  if (action === "del") {
    const ok = await modalConfirmar("Excluir recorrÃªncia", "Excluir essa recorrÃªncia?", "Excluir");
    if (!ok) return;
    await api(`/api/recorrencias/${id}`, { method: "DELETE" });
    await carregarRecorrencias();
    return;
  }

  if (action === "edit") {
    const recs = await api("/api/recorrencias").then(r => r.json());
    const r = recs.find(x => x.id === id);
    if (!r) return;

    rId.value = r.id;
    rDesc.value = r.descricao;
    rValor.value = r.valor;
    rTipo.value = r.tipo;
    rDia.value = r.dia_mes;
    rAtivo.checked = !!r.ativo;
    if (r.categoria_id) rCat.value = r.categoria_id;

    rDesc.focus();
  }
});

btnGerar?.addEventListener("click", async () => {
  const mes = rMes.value.trim(); // YYYY-MM
  const resp = await api(`/api/recorrencias/gerar?mes=${encodeURIComponent(mes)}`, {
    method: "POST"
  }).then(r => r.json());

  if (typeof abrirModal === "function") {
    await abrirModal({
      titulo: "Recorrencias geradas",
      texto: `Criadas: ${resp.criadas}`,
      mostrarCancelar: false,
      fecharAoClicarFora: true
    });
  } else {
    await modalAviso("Recorrencias geradas", `Criadas: ${resp.criadas}`);
  }
  await refreshTudo();
});

// chame isso no seu init()
(async function initRec() {
  if (!formRec) return;
  await carregarCategoriasRec();
  await carregarRecorrencias();
  await carregarResumoRecorrencias();
})();

async function carregarResumo() {

  if (!filtroMes) return;

  const mes = filtroMes.value;

  const r = await api(`/api/resumo?mes=${mes}`);
  const dados = await r.json();

  if (!resumoDiv) return;

  resumoDiv.innerHTML = `
    <p>Saldo total: ${money(dados.saldo)}</p>
    <p>Entradas: ${money(dados.entradas)}</p>
    <p>SaÃ­das: ${money(dados.saidas)}</p>
  `;
}
const chartCanvas = document.querySelector("#chartCats");
let chartCats = null;

async function carregarGraficoCategorias() {
  if (!chartCanvas) return;

  const mes = (filtroMes && filtroMes.value) ? filtroMes.value : null;
  if (!mes) return;

  const dados = await api(`/api/relatorio-categorias?mes=${encodeURIComponent(mes)}`).then(r => r.json());

  const labels = dados.map(x => x.categoria);
  const saidas = dados.map(x => Number(x.total_saidas || 0));
  const entradas = dados.map(x => Number(x.total_entradas || 0));

  // destrÃ³i o antigo antes de criar outro (evita bug)
  if (chartCats) chartCats.destroy();

  chartCats = new Chart(chartCanvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "SaÃ­das", data: saidas, backgroundColor: "#ef4444" },
        { label: "Entradas", data: entradas, backgroundColor: "#22c55e" },
      ]
    },
    options: {
      responsive: true,
      animation: chartAnimationOptions,
      plugins: { legend: { position: "top" } },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
}

const previsaoDiv = document.querySelector("#previsao");

async function carregarPrevisao() {
  if (!previsaoDiv || !filtroMes?.value) return;

  const p = await api(`/api/previsao?mes=${encodeURIComponent(filtroMes.value)}`).then(r => r.json());

  previsaoDiv.innerHTML = `
    <b>Saldo atual:</b> ${money(p.saldo_atual)}<br/>
    <b>Entradas previstas:</b> ${money(p.entradas_previstas)}<br/>
    <b>SaÃ­das previstas:</b> ${money(p.saidas_previstas)}<br/>
    <b>Saldo previsto (fim do mÃªs):</b> ${money(p.saldo_previsto)}
  `;
}

async function carregarFatura() {

  if (!fatCartao || !fatMes) return;

  const cartaoId = Number(fatCartao.value);
  const mes = fatMes.value;

  if (!cartaoId || !mes) return;

  const resp = await api(`/api/cartoes/${cartaoId}/fatura?mes=${encodeURIComponent(mes)}`);

  if (!resp.ok) {
    console.error("Erro ao buscar fatura");
    return;
  }

  const dados = await resp.json();

  fatTotal.innerHTML =
    `<b>Total da fatura:</b> ${money(dados.total)} (mostrar como negativo)`;

  fatItens.innerHTML = dados.itens.map(i => `
    <tr>
      <td>${i.numero_parcela}/${i.total_parcelas}</td>
      <td>${i.descricao}</td>
      <td>${i.categoria ?? "-"}</td>
      <td>${i.mes_ref}</td>
      <td>${money(i.valor)}</td>
      <td>${i.status}</td>
    </tr>
  `).join("");

  await carregarPrevisaoCartao(cartaoId);
  
}

async function carregarMetas(){
  const mes = filtroMes.value;
  const dados = await api(`/api/metas?mes=${mes}`).then(r=>r.json());

  metasBody.innerHTML = dados.map(m => {

    const perc = m.valor_meta > 0
      ? ((m.gasto_mes / m.valor_meta) * 100).toFixed(0)
      : 0;

    const alerta = perc > 100 ? "âš " : "";

    return `
      <tr>
        <td>${m.categoria}</td>
        <td>${money(m.valor_meta)}</td>
        <td>${money(m.gasto_mes)}</td>
        <td>${perc}% ${alerta}</td>
      </tr>
    `;
  }).join("");
}

async function carregarCategoriasMeta() {
  const cats = await api("/api/categorias").then(r => r.json());

  metaCategoria.innerHTML =
    `<option value="">Selecione</option>` +
    cats.map(c => `<option value="${c.id}">${c.nome}</option>`).join("");
}

btnMeta?.addEventListener("click", async () => {

  await api("/api/metas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      categoria_id: Number(metaCategoria.value),
      valor_meta: Number(metaValor.value),
      mes: filtroMes.value
    })
  });

  metaValor.value = "";
  await refreshTudo();
});

const controleDiv = document.querySelector("#controleCartao");

async function carregarControleCartao() {

  const cartaoId = fatCartao.value;
  if (!cartaoId) return;

  const dados = await api(`/api/cartoes/${cartaoId}/controle`).then(r => r.json());

  if (!dados) return;

  const cor =
    dados.percentual >= 80 ? "red" :
    dados.percentual >= 50 ? "orange" :
    "green";

  controleDiv.innerHTML = `
  <h3>${dados.nome}</h3>
  <div class="limite-info">
    <div>
      <span>Limite</span>
      <strong>${money(dados.limite)}</strong>
    </div>
    <div>
      <span>Usado</span>
      <strong>${money(dados.usado)}</strong>
    </div>
    <div>
      <span>DisponÃ­vel</span>
      <strong>${money(dados.disponivel)}</strong>
    </div>
  </div>
  <div class="barra-limite">
    <div class="barra-preenchimento" 
         style="width:${dados.percentual}%; background:${cor};">
    </div>
  </div>
  <div class="percentual-uso" style="color:${cor}">
    ${dados.percentual.toFixed(0)}% utilizado
  </div>
`;
}
fatCartao?.addEventListener("change", carregarControleCartao);

async function refreshTudo() {
  const safeRun = async (fn, nome) => {
    try {
      await fn();
    } catch (err) {
      console.error(`[refreshTudo] Falha em ${nome}:`, err?.message || err);
    }
  };

  if (typeof carregarTransacoes === "function") await safeRun(carregarTransacoes, "carregarTransacoes");
  if (typeof carregarResumo === "function") await safeRun(carregarResumo, "carregarResumo");
  if (typeof carregarRelatorioCategorias === "function") await safeRun(carregarRelatorioCategorias, "carregarRelatorioCategorias");
  if (typeof carregarPrevisao === "function") await safeRun(carregarPrevisao, "carregarPrevisao");
  if (typeof carregarFatura === "function") await safeRun(carregarFatura, "carregarFatura");
  if (typeof carregarDashboard === "function") await safeRun(carregarDashboard, "carregarDashboard");
  if (typeof carregarControleCartao === "function") await safeRun(carregarControleCartao, "carregarControleCartao");
  if (typeof carregarCaixinhas === "function") await safeRun(carregarCaixinhas, "carregarCaixinhas");

  // Graficos por ultimo: falha de grafico nao pode impedir a renderizacao principal.
  if (typeof carregarGraficoCategorias === "function") await safeRun(carregarGraficoCategorias, "carregarGraficoCategorias");
  if (typeof carregarGraficoMensal === "function") await safeRun(carregarGraficoMensal, "carregarGraficoMensal");
  if (typeof carregarGraficoDiario === "function") await safeRun(() => carregarGraficoDiario(filtroMes.value), "carregarGraficoDiario");
  if (typeof carregarGraficoCaixinhas === "function") await safeRun(carregarGraficoCaixinhas, "carregarGraficoCaixinhas");
}

// ===== CARTÃƒO (visualizaÃ§Ã£o/teste) =====
const formCartao = document.querySelector("#formCartao");
const cNome = document.querySelector("#c_nome");
const cLimite = document.querySelector("#c_limite");
const cFech = document.querySelector("#c_fech");
const cVenc = document.querySelector("#c_venc");
const tituloModalCartao = document.querySelector("#tituloModalCartao");
const btnSalvarCartao = document.querySelector("#btnSalvarCartao");
const btnEditarCartao = document.querySelector("#btnEditarCartao");
const btnExcluirCartao = document.querySelector("#btnExcluirCartao");
const abrirModalCartaoBtn = document.querySelector("#abrirModalCartao");
const modalCartao = document.querySelector("#modalCartao");
let cartoesCache = [];
let cartaoEditandoId = null;

const formCompra = document.querySelector("#formCompra");
const ccCartao = document.querySelector("#cc_cartao");
const ccDesc = document.querySelector("#cc_desc");
const ccTotal = document.querySelector("#cc_total");
const ccParc = document.querySelector("#cc_parc");
const ccJuros = document.querySelector("#cc_juros");
const ccData = document.querySelector("#cc_data");
const ccCat = document.querySelector("#cc_cat");

if (fatMes) fatMes.value = mesAtualYYYYMM();
if (ccData) ccData.valueAsDate = new Date();

async function carregarCartoes() {
  const cartoes = await api("/api/cartoes").then(r => r.json());
  cartoesCache = cartoes;

  const selecionadoFatura = fatCartao?.value || "";
  const selecionadoForm = cartaoSelect?.value || "";

  const opts = cartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join("");
  if (ccCartao) {
    ccCartao.innerHTML = opts;
    if (selecionadoFatura && cartoes.some(c => String(c.id) === String(selecionadoFatura))) {
      ccCartao.value = String(selecionadoFatura);
    }
  }
  if (fatCartao) {
    fatCartao.innerHTML = opts;
    if (selecionadoFatura && cartoes.some(c => String(c.id) === String(selecionadoFatura))) {
      fatCartao.value = String(selecionadoFatura);
    }
  }
  if (cartaoSelect) {
    if (selecionadoForm && cartoes.some(c => String(c.id) === String(selecionadoForm))) {
      cartaoSelect.value = String(selecionadoForm);
    }
  }
}

function resetFormCartaoParaCriacao() {
  cartaoEditandoId = null;
  if (tituloModalCartao) tituloModalCartao.textContent = "Criar CartÃ£o";
  if (btnSalvarCartao) btnSalvarCartao.textContent = "Criar";
  formCartao?.reset();
}

function preencherFormCartaoParaEdicao(cartao) {
  cartaoEditandoId = Number(cartao.id);
  if (tituloModalCartao) tituloModalCartao.textContent = "Editar CartÃ£o";
  if (btnSalvarCartao) btnSalvarCartao.textContent = "Salvar alteraÃ§Ãµes";

  cNome.value = cartao.nome ?? "";
  cLimite.value = Number(cartao.limite ?? 0);
  cFech.value = Number(cartao.dia_fechamento ?? 1);
  cVenc.value = Number(cartao.dia_vencimento ?? 1);
}

function setMesAtualFatura(){
  const hoje = new Date();
  const mes = hoje.toISOString().slice(0,7);
  document.getElementById("fat_mes").value = mes;
}

async function carregarCategoriasCartao() {
  const cats = await api("/api/categorias").then(r => r.json());
  if (ccCat) ccCat.innerHTML = cats.map(c => `<option value="${c.id}">${c.nome}</option>`).join("");
}

formCartao?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const payload = {
    nome: cNome.value,
    limite: Number(cLimite.value || 0),
    dia_fechamento: Number(cFech.value),
    dia_vencimento: Number(cVenc.value)
  };

  if (cartaoEditandoId) {
    await api(`/api/cartoes/${cartaoEditandoId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } else {
    await api("/api/cartoes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  resetFormCartaoParaCriacao();
  if (modalCartao) modalCartao.style.display = "none";

  await carregarCartoes();
  await carregarCartoesNoForm();
  await carregarControleCartao();
  await carregarFatura();
});

abrirModalCartaoBtn?.addEventListener("click", () => {
  resetFormCartaoParaCriacao();
});

btnEditarCartao?.addEventListener("click", async () => {
  const cartaoId = Number(fatCartao?.value);
  if (!cartaoId) {
    await abrirModal({
      titulo: "Aviso",
      texto: "Selecione um cartao para editar.",
      mostrarCancelar: false
    });
    return;
  }

  const cartao = cartoesCache.find(c => Number(c.id) === cartaoId);
  if (!cartao) {
    await abrirModal({
      titulo: "Erro",
      texto: "Cartao nao encontrado.",
      mostrarCancelar: false
    });
    return;
  }

  preencherFormCartaoParaEdicao(cartao);
  if (modalCartao) modalCartao.style.display = "flex";
});

btnExcluirCartao?.addEventListener("click", async () => {
  const cartaoId = Number(fatCartao?.value);
  if (!cartaoId) {
    await abrirModal({
      titulo: "Aviso",
      texto: "Selecione um cartao para excluir.",
      mostrarCancelar: false
    });
    return;
  }

  const ok = await abrirModal({
    titulo: "Confirmar exclusao",
    texto: "Tem certeza que deseja excluir este cartao?",
    mostrarCancelar: true,
    confirmarTexto: "Excluir"
  });

  if (!ok) return;

  await api(`/api/cartoes/${cartaoId}`, {
    method: "DELETE"
  });

  await abrirModal({
    titulo: "Sucesso",
    texto: "Cartao excluido com sucesso.",
    mostrarCancelar: false,
    fecharAoClicarFora: true
  });

  await carregarCartoes();
  await carregarCartoesNoForm();
  await carregarControleCartao();
  await carregarFatura();
});

formCompra?.addEventListener("submit", async (e) => {
  e.preventDefault();
  await api("/api/cartoes/compra", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cartao_id: Number(ccCartao.value),
      descricao: ccDesc.value,
      valor_total: Number(ccTotal.value),
      parcelas: Number(ccParc.value),
      juros_mensal: Number(ccJuros.value || 0),
      data_compra: ccData.value,
      categoria_id: Number(ccCat.value)
    })
  });
  formCompra.reset();
  ccData.valueAsDate = new Date();
  await modalAviso("Sucesso", "Compra lanÃ§ada e parcelas geradas!");
});

btnFat?.addEventListener("click", async () => {
  const cartaoId = Number(fatCartao.value);
  const mes = fatMes.value;
  const f = await api(`/api/cartoes/${cartaoId}/fatura?mes=${encodeURIComponent(mes)}`).then(r => r.json());

  fatTotal.innerHTML = `<b>Total da fatura:</b> ${money(f.total)}`;

  fatItens.innerHTML = f.itens.map(x => `
  <tr>
    <td>${x.numero_parcela}/${x.total_parcelas}</td>
    <td>${x.descricao}</td>
    <td>${x.categoria ?? "-"}</td>
    <td>${x.mes_ref}</td>
    <td>${money(x.valor)}</td>
    <td>${x.status}</td>
    <td>
      <button class="btnParcelas" data-compra="${x.compra_id}">
        Ver parcelas
      </button>
    </td>
  </tr>
`).join("");
});

(async function initCartao() {
  if (!formCartao && !formCompra) return;
  await carregarCategoriasCartao();
  await carregarCartoes();
  await carregarFatura();
})();

// FunÃ§Ã£o utilitÃ¡ria para abrir/fechar modais de forma segura
function setupModal(modalId, openBtnId, closeBtnId) {
  const modal = document.getElementById(modalId);
  const openBtn = document.getElementById(openBtnId);
  const closeBtn = document.getElementById(closeBtnId);
  if (!modal) return;

  if (openBtn) {
    openBtn.addEventListener("click", () => {
      modal.style.display = "flex";
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }
  window.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      modal.style.display = "none";
    }
  });
}

// Setup para todos os modais principais
setupModal("modalCartao", "abrirModalCartao", "fecharModalCartao");
setupModal("modalRec", "abrirModalRec", "fecharModalRec");
setupModal("modalParcelas", null, "fecharParcelas");
setupModal("modalCategoria", "btnNovaCategoria", "cancelarCategoria");
// Modal padrÃ£o jÃ¡ tem lÃ³gica prÃ³pria, nÃ£o precisa duplicar
const btnPDF = document.getElementById("btnPDF");

btnPDF?.addEventListener("click", () => {
  const mes = filtroMes.value;

  if (!mes) {
    modalAviso("Aviso", "Selecione um mÃªs");
    return;
  }

  window.open(`/api/relatorio-pdf?mes=${mes}&token=${token}`, "_blank");
});


function bindPagarFatura() {
  const btnPagarFatura = document.querySelector("#btnPagarFatura");
  if (!btnPagarFatura) {
    console.warn("[PagarFatura] Botao nao encontrado");
    return;
  }

  btnPagarFatura.addEventListener("click", async () => {
    console.log("[PagarFatura] CLICOU");
    console.log("[PagarFatura] fatCartao/fatMes:", fatCartao, fatMes);
    console.log("[PagarFatura] api type:", typeof api);

    const cartaoId = fatCartao?.value;
    const mes = fatMes?.value;

    if (!cartaoId || !mes) {
      await abrirModal({
        titulo: "Erro",
        texto: "Selecione um cartao e um mes para pagar a fatura."
      });
      return;
    }

    const faturaResp = await api(`/api/cartoes/${cartaoId}/fatura?mes=${encodeURIComponent(mes)}`);
    if (!faturaResp.ok) {
      await abrirModal({
        titulo: "Erro",
        texto: "Erro ao buscar fatura"
      });
      return;
    }

    const fatura = await faturaResp.json();
    if (fatura.total === 0) {
      await abrirModal({
        titulo: "Aviso",
        texto: "Essa fatura jÃ¡ estÃ¡ paga ou nÃ£o possui parcelas abertas"
      });
      return;
    }

    const ok = await abrirModal({
      titulo: "Confirmar",
      texto: "Confirmar pagamento da fatura?"
    });
    if (!ok) return;

    try {
      const resp = await api(`/api/cartoes/${cartaoId}/pagar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes })
      });

      await abrirModal({
        titulo: "Sucesso",
        texto: "Fatura paga!",
        mostrarCancelar: false,
        fecharAoClicarFora: true
      });
      await refreshTudo();
    } catch (err) {
      await abrirModal({
        titulo: "Erro",
        texto: "Erro ao pagar fatura: " + (err.message || err)
      });
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindPagarFatura);
} else {
  bindPagarFatura();
}



const modalParcelas = document.querySelector("#modalParcelas");
const parcelasTimeline = document.querySelector("#parcelasTimeline");
const fecharParcelas = document.querySelector("#fecharParcelas");
const timeline = document.querySelector("#parcelasTimeline");

document.addEventListener("click", async (e) => {

  const btn = e.target.closest("[data-compra]");
  if(!btn) return;

  const compraId = btn.dataset.compra;

  const parcelas = await api(`/api/cartoes/compra/${compraId}/parcelas`)
    .then(r => r.json());

  parcelasTimeline.innerHTML = parcelas.map(p => `
    <tr>
      <td>${p.numero_parcela}/${p.total_parcelas}</td>
      <td>${p.mes_ref}</td>
      <td>${money(p.valor)}</td>
      <td>${p.status}</td>
    </tr>
  `).join("");

  modalParcelas.style.display = "flex";
});

fecharParcelas.addEventListener("click", () => {
  modalParcelas.style.display = "none";
});

window.addEventListener("click", (e) => {
  if(e.target === modalParcelas){
    modalParcelas.style.display = "none";
  }
});

document.addEventListener("click", async (e) => {

  const btn = e.target.closest("[data-compra]");
  if(!btn) return;

  const compraId = btn.dataset.compra;

  const parcelas = await api(`/api/cartoes/compra/${compraId}/parcelas`)
    .then(r => r.json());

  timeline.innerHTML = parcelas.map(p => {

    const statusIcon =
      p.status === "paga" ? "âœ”" :
      p.status === "aberta" ? "â³" :
      "â€¢";

    return `
      <div class="timeline-item">
        <div class="timeline-status">${statusIcon}</div>

        <div class="timeline-info">
          ${p.numero_parcela}/${p.total_parcelas} - ${p.mes_ref}
        </div>

        <div class="timeline-valor">
          ${money(p.valor)}
        </div>
      </div>
    `;

  }).join("");

  modalParcelas.style.display = "flex";
});

fecharParcelas.addEventListener("click", () => {
  modalParcelas.style.display = "none";
});

window.addEventListener("click", (e) => {
  if(e.target === modalParcelas){
    modalParcelas.style.display = "none";
  }
});

async function carregarPrevisaoCartao(cartaoId){

  const prev = await api(`/api/cartoes/${cartaoId}/previsao`)
    .then(r => r.json());

  const div = document.querySelector("#previsaoCartao");

  div.innerHTML = prev.map(p => `
    <div class="prev-item">
      <span>${p.mes_ref}</span>
      <strong>${money(p.total)}</strong>
    </div>
  `).join("");

}

document.addEventListener("DOMContentLoaded", () => {

  const modal = document.querySelector("#modalPadrao");
  const modalTitulo = document.querySelector("#modalTitulo");
  const modalTexto = document.querySelector("#modalTexto");
  const modalInput = document.querySelector("#modalInput");
  const modalOk = document.querySelector("#modalOk");
  const modalCancelar = document.querySelector("#modalCancelar");

  window.abrirModal = function({
    titulo,
    texto,
    input = false,
    mostrarCancelar = true,
    fecharAoClicarFora = true,
    confirmarTexto = "OK"
  }){

    modalTitulo.innerText = titulo;
    modalTexto.innerText = texto;

    modalInput.style.display = input ? "block" : "none";
    modalInput.value = "";
    modalCancelar.style.display = mostrarCancelar ? "inline-block" : "none";
    modalOk.textContent = confirmarTexto;

    modal.style.display = "flex";

    return new Promise(resolve => {

      const fecharModal = (resultado) => {
        modal.style.display = "none";
        modal.removeEventListener("click", onBackdropClick);
        document.removeEventListener("keydown", onEsc);
        resolve(resultado);
      };

      const onBackdropClick = (e) => {
        if (fecharAoClicarFora && e.target === modal) {
          fecharModal(false);
        }
      };

      const onEsc = (e) => {
        if (e.key === "Escape") {
          fecharModal(false);
        }
      };

      modal.addEventListener("click", onBackdropClick);
      document.addEventListener("keydown", onEsc);

      modalOk.onclick = () => {
        fecharModal(input ? modalInput.value : true);
      };

      modalCancelar.onclick = () => {
        fecharModal(false);
      };

    });

  };

});

document.addEventListener("DOMContentLoaded", () => {

  const btnNovaCategoria = document.querySelector("#btnNovaCategoria");
  const modalCategoria = document.querySelector("#modalCategoria");
  const salvarCategoria = document.querySelector("#salvarCategoria");
  const cancelarCategoria = document.querySelector("#cancelarCategoria");
  const inputCategoria = document.querySelector("#inputCategoria");

  async function atualizarListasDeCategorias() {
    if (typeof carregarCategorias === "function") await carregarCategorias();
    if (typeof carregarCategoriasMeta === "function") await carregarCategoriasMeta();
    if (typeof carregarCategoriasRec === "function") await carregarCategoriasRec();
    if (typeof carregarCategoriasCartao === "function") await carregarCategoriasCartao();
  }

  btnNovaCategoria?.addEventListener("click", () => {
    modalCategoria.style.display = "flex";
    inputCategoria.value = "";
    inputCategoria.focus();
  });

  cancelarCategoria?.addEventListener("click", () => {
    modalCategoria.style.display = "none";
  });

  salvarCategoria?.addEventListener("click", async () => {

    const nome = inputCategoria.value.trim();
    if(!nome) return;

    await api("/api/categorias",{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ nome })
    });

    modalCategoria.style.display = "none";

    await atualizarListasDeCategorias();
    await refreshTudo();
  });

});

window.addEventListener("click", (e)=>{
  const modalCategoria = document.querySelector("#modalCategoria");
  if(e.target === modalCategoria){
    modalCategoria.style.display="none";
  }
});

function logout() {
  localStorage.removeItem("token");
  sessionStorage.removeItem("token");
  window.location.href = "/login.html";
}

document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.querySelectorAll(".tab");
  const tabContents = document.querySelectorAll(".tab-content");

  if (!tabs.length || !tabContents.length) return;

  async function reanimarGraficosAoAbrirAba() {
    if (chartCats) {
      chartCats.destroy();
      chartCats = null;
    }
    if (chartMensal) {
      chartMensal.destroy();
      chartMensal = null;
    }
    if (chartDiario) {
      chartDiario.destroy();
      chartDiario = null;
    }
    if (chartCaixinhas) {
      chartCaixinhas.destroy();
      chartCaixinhas = null;
    }

    // Espera o repaint da aba ativa para garantir que os canvases estejam visiveis.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 40));

    if (typeof carregarGraficoCategorias === "function") {
      await carregarGraficoCategorias();
    }
    if (typeof carregarGraficoMensal === "function") {
      await carregarGraficoMensal();
    }
    if (typeof carregarGraficoDiario === "function") {
      await carregarGraficoDiario(filtroMes.value);
    }
    if (typeof carregarGraficoCaixinhas === "function") {
      await carregarGraficoCaixinhas();
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", async () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tabContents.forEach((c) => c.classList.remove("active"));
      const target = document.getElementById(tab.dataset.tab);
      if (!target) return;

      // Separa a ativacao em outro frame para garantir a animacao de entrada.
      await new Promise((resolve) => requestAnimationFrame(resolve));

      tab.classList.add("active");
      target.classList.add("active");

      if (tab.dataset.tab === "graficos") {
        await reanimarGraficosAoAbrirAba();
      }
    });
  });
});

async function carregarGraficoDiario(mes) {
  const resp = await api(`/api/diario?mes=${mes}`);
  const dados = await resp.json();

  const labels = dados.map(d => d.dia);

  const entradas = dados.map(d => d.entradas);
  const saidas = dados.map(d => d.saidas);

  if (chartDiario) chartDiario.destroy();

  chartDiario = new Chart(document.getElementById("graficoDiario"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Entradas",
          data: entradas,
          borderColor: "#22c55e",
          backgroundColor: "#22c55e33",
          tension: 0.3
        },
        {
          label: "SaÃ­das",
          data: saidas,
          borderColor: "#ef4444",
          backgroundColor: "#ef444433",
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      animation: chartAnimationOptions,
      plugins: {
        legend: { labels: { color: "#fff" } }
      },
      scales: {
        x: {
          ticks: { color: "#aaa" }
        },
        y: {
          ticks: { color: "#aaa" }
        }
      }
    }
  });
}
