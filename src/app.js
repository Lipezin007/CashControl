const lista = document.querySelector("#lista");
const form = document.querySelector("#form");
const resumoDiv = document.querySelector("#resumo");
const relCats = document.querySelector("#relCats");

const filtroMes = document.querySelector("#filtroMes");

function mesAtualYYYYMM() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

if (filtroMes && !filtroMes.value) {
  filtroMes.value = mesAtualYYYYMM();
}

const idInput = document.querySelector("#id");
const descricaoInput = document.querySelector("#descricao");
const valorInput = document.querySelector("#valor");
const tipoInput = document.querySelector("#tipo");
const categoriaSelect = document.querySelector("#categoria");
const dataInput = document.querySelector("#data");

const origemInput = document.querySelector("#origem");
const areaCartao = document.querySelector("#areaCartao");

function ajustarTipoCartao() {

  if (origemInput.value === "cartao_credito") {

    tipoInput.value = "saida";
    tipoInput.disabled = true;

  } else {

    tipoInput.disabled = false;

  }

}

origemInput.addEventListener("change", ajustarTipoCartao);
ajustarTipoCartao();

function toggleCartaoUI(){
  if (!origemInput || !areaCartao) return;
  areaCartao.classList.toggle("mostrar", origemInput.value === "cartao_credito");
}
origemInput?.addEventListener("change", toggleCartaoUI);
toggleCartaoUI();

dataInput.valueAsDate = new Date();

const cartaoSelect = document.querySelector("#cartaoSelect"); // o select que fica na Nova transação

async function carregarCartoesNoForm() {
  if (!cartaoSelect) return;

  const cartoes = await fetch("/api/cartoes").then(r => r.json());

  cartaoSelect.innerHTML =
    `<option value="">Selecione o cartão</option>` +
    cartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join("");
}

// MOSTRAR / ESCONDER AREA DE CARTÃO
function toggleCartaoUI() {
  if (!origemInput || !areaCartao) return;
  areaCartao.classList.toggle("mostrar", origemInput.value === "cartao_credito");
}

// executa quando mudar o select
if (origemInput) {
  origemInput.addEventListener("change", toggleCartaoUI);
}

// executa quando abrir a página
toggleCartaoUI();
origemInput?.addEventListener("change", toggleCartaoUI);
toggleCartaoUI(); // já aplica ao abrir a página

dataInput.valueAsDate = new Date();

async function carregarRelatorioCategorias() {
  if (!relCats) return;

  const mes = (filtroMes && filtroMes.value) ? filtroMes.value : null;
  if (!mes) { relCats.innerHTML = ""; return; }

  const dados = await fetch(`/api/relatorio-categorias?mes=${encodeURIComponent(mes)}`).then(r => r.json());

  relCats.innerHTML = dados.map(x => `
    <tr>
      <td>${x.categoria}</td>
      <td>${money(x.total_saidas)}</td>
      <td>${money(x.total_entradas)}</td>
    </tr>
  `).join("");
}

function money(v) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function carregarCategorias() {
  const cats = await fetch("/api/categorias").then(r => r.json());

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
  const trans = await fetch(url).then(r => r.json());

  lista.innerHTML = trans.map(t => `
    <tr>
      <td>${t.data}</td>
      <td>
      ${t.parcela_num ? `${t.descricao} (${t.parcela_num}/${t.parcela_total})` : t  .descricao}
      </td>
      <td>${t.categoria ?? "-"}</td>
      <td>${t.tipo}</td>
      <td>${money(t.valor)}</td>
      <td>
        <button data-action="edit" data-id="${t.id}">Editar</button>
        <button data-action="del" data-id="${t.id}">Excluir</button>
      </td>
    </tr>
  `).join("");
}

// Delegação de eventos pros botões da tabela
lista.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const action = btn.dataset.action;
  const id = Number(btn.dataset.id);

  if (action === "del") {
    if (!confirm("Excluir essa transação?")) return;
    await fetch(`/api/movimentacoes/${id}`, { method: "DELETE" });
    await refreshTudo();
    return;
  }

  if (action === "edit") {
    // pega a transação atual pra preencher o form
    const trans = await fetch(`/api/movimentacoes?mes=${encodeURIComponent(filtroMes.value)}`).then(r=>r.json());
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

form.addEventListener("submit", async (e) => {
  e.preventDefault();
const cartaoSelect = document.querySelector("#cartaoSelect");
const parcelasInput = document.querySelector("#parcelasInput");
const jurosInput = document.querySelector("#jurosInput");
  const isCartao = origemInput.value === "cartao_credito";

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
    // EDITAR
    await fetch(`/api/movimentacoes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } else {
    // CRIAR
    await fetch("/api/movimentacoes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  // limpa form e recarrega
  form.reset();
  idInput.value = "";
  dataInput.valueAsDate = new Date();

  await refreshTudo();
});

(async function init() {
  if (filtroMes && !filtroMes.value) {
    filtroMes.value = mesAtualYYYYMM();
  }

  await carregarCategorias();
  await carregarTransacoes();
  await carregarResumo();
  await carregarRelatorioCategorias();
  await carregarGraficoCategorias();
  await carregarPrevisao();
  await carregarCartoesNoForm();
  await refreshTudo();
})();
// ====== RECORRÊNCIAS (visualização/teste) ======
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
  const cats = await fetch("/api/categorias").then(r => r.json());
  rCat.innerHTML = cats.map(c => `<option value="${c.id}">${c.nome}</option>`).join("");
}

async function carregarResumoRecorrencias() {
  if (!resumoRec) return;
  const r = await fetch("/api/recorrencias/resumo").then(x => x.json());
  resumoRec.innerHTML = `
    <b>Só recorrências ativas:</b>
    Entradas ${money(r.entradas)} | Saídas ${money(r.saidas)} | Saldo ${money(r.saldo)}
  `;
}

async function carregarRecorrencias() {
  const recs = await fetch("/api/recorrencias").then(r => r.json());
  listaRec.innerHTML = recs.map(r => `
    <tr>
      <td>${r.dia_mes}</td>
      <td>${r.descricao}</td>
      <td>${r.categoria ?? "-"}</td>
      <td>${r.tipo}</td>
      <td>${money(r.valor)}</td>
      <td>${r.ativo ? "Sim" : "Não"}</td>
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
    await fetch(`/api/recorrencias/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } else {
    await fetch("/api/recorrencias", {
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
    if (!confirm("Excluir essa recorrência?")) return;
    await fetch(`/api/recorrencias/${id}`, { method: "DELETE" });
    await carregarRecorrencias();
    return;
  }

  if (action === "edit") {
    const recs = await fetch("/api/recorrencias").then(r => r.json());
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
  const resp = await fetch(`/api/recorrencias/gerar?mes=${encodeURIComponent(mes)}`, { method: "POST" })
    .then(r => r.json());

  alert(`Criadas: ${resp.criadas}`);
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

  const mes = filtroMes.value;

  const r = await fetch(`/api/resumo?mes=${mes}`);
  const dados = await r.json();

  resumoDiv.innerHTML = `
    <p>Saldo total: ${money(dados.saldo)}</p>
    <p>Entradas: ${money(dados.entradas)}</p>
    <p>Saídas: ${money(dados.saidas)}</p>
  `;
}
const chartCanvas = document.querySelector("#chartCats");
let chartCats = null;

async function carregarGraficoCategorias() {
  if (!chartCanvas) return;

  const mes = (filtroMes && filtroMes.value) ? filtroMes.value : null;
  if (!mes) return;

  const dados = await fetch(`/api/relatorio-categorias?mes=${encodeURIComponent(mes)}`)
    .then(r => r.json());

  const labels = dados.map(x => x.categoria);
  const saidas = dados.map(x => Number(x.total_saidas || 0));
  const entradas = dados.map(x => Number(x.total_entradas || 0));

  // destrói o antigo antes de criar outro (evita bug)
  if (chartCats) chartCats.destroy();

  chartCats = new Chart(chartCanvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Saídas", data: saidas, backgroundColor: "#ef4444" },
        { label: "Entradas", data: entradas, backgroundColor: "#22c55e" },
      ]
    },
    options: {
      responsive: true,
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

  const p = await fetch(`/api/previsao?mes=${encodeURIComponent(filtroMes.value)}`).then(r => r.json());

  previsaoDiv.innerHTML = `
    <b>Saldo atual:</b> ${money(p.saldo_atual)}<br/>
    <b>Entradas previstas:</b> ${money(p.entradas_previstas)}<br/>
    <b>Saídas previstas:</b> ${money(p.saidas_previstas)}<br/>
    <b>Saldo previsto (fim do mês):</b> ${money(p.saldo_previsto)}
  `;
}

async function refreshTudo() {
  // lista + resumo
  if (typeof carregarTransacoes === "function") await carregarTransacoes();
  if (typeof carregarResumo === "function") await carregarResumo();

  // relatório + gráfico (dependem do mês)
  if (typeof carregarRelatorioCategorias === "function") await carregarRelatorioCategorias();
  if (typeof carregarGraficoCategorias === "function") await carregarGraficoCategorias();

  // previsão (se tiver)
  if (typeof carregarPrevisao === "function") await carregarPrevisao();
}

// ===== CARTÃO (visualização/teste) =====
const formCartao = document.querySelector("#formCartao");
const cNome = document.querySelector("#c_nome");
const cLimite = document.querySelector("#c_limite");
const cFech = document.querySelector("#c_fech");
const cVenc = document.querySelector("#c_venc");

const formCompra = document.querySelector("#formCompra");
const ccCartao = document.querySelector("#cc_cartao");
const ccDesc = document.querySelector("#cc_desc");
const ccTotal = document.querySelector("#cc_total");
const ccParc = document.querySelector("#cc_parc");
const ccJuros = document.querySelector("#cc_juros");
const ccData = document.querySelector("#cc_data");
const ccCat = document.querySelector("#cc_cat");

const fatCartao = document.querySelector("#fat_cartao");
const fatMes = document.querySelector("#fat_mes");
const btnFat = document.querySelector("#btnFat");
const fatTotal = document.querySelector("#fat_total");
const fatItens = document.querySelector("#fat_itens");

if (fatMes) fatMes.value = mesAtualYYYYMM();
if (ccData) ccData.valueAsDate = new Date();

async function carregarCartoes() {
  const cartoes = await fetch("/api/cartoes").then(r => r.json());
  const opts = cartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join("");
  if (ccCartao) ccCartao.innerHTML = opts;
  if (fatCartao) fatCartao.innerHTML = opts;
}

async function carregarCategoriasCartao() {
  const cats = await fetch("/api/categorias").then(r => r.json());
  if (ccCat) ccCat.innerHTML = cats.map(c => `<option value="${c.id}">${c.nome}</option>`).join("");
}

formCartao?.addEventListener("submit", async (e) => {
  e.preventDefault();
  await fetch("/api/cartoes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nome: cNome.value,
      limite: Number(cLimite.value || 0),
      dia_fechamento: Number(cFech.value),
      dia_vencimento: Number(cVenc.value)
    })
  });
  formCartao.reset();
  await carregarCartoes();
  await carregarCartoesNoForm();
});

formCompra?.addEventListener("submit", async (e) => {
  e.preventDefault();
  await fetch("/api/cartoes/compra", {
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
  alert("Compra lançada e parcelas geradas!");
});

btnFat?.addEventListener("click", async () => {
  const cartaoId = Number(fatCartao.value);
  const mes = fatMes.value;
  const f = await fetch(`/api/cartoes/${cartaoId}/fatura?mes=${encodeURIComponent(mes)}`).then(r => r.json());

  fatTotal.innerHTML = `<b>Total da fatura:</b> ${money(f.total)} (mostre como negativo no app)`;

  fatItens.innerHTML = f.itens.map(x => `
    <tr>
      <td>${x.numero_parcela}/${x.total_parcelas}</td>
      <td>${x.descricao}</td>
      <td>${x.categoria ?? "-"}</td>
      <td>${x.mes_ref}</td>
      <td>${money(x.valor)}</td>
      <td>${x.status}</td>
    </tr>
  `).join("");
});

(async function initCartao() {
  if (!formCartao && !formCompra) return;
  await carregarCategoriasCartao();
  await carregarCartoes();
})();

