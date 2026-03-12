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

const filtroMes = document.querySelector("#filtroMes");

const chartMensalCanvas = document.querySelector("#chartMensal");
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

function mesAtualYYYYMM() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

if (filtroMes && !filtroMes.value) {
  filtroMes.value = mesAtualYYYYMM();
}

const areaCartao = document.querySelector("#areaCartao");

const token = localStorage.getItem("token");

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
      datasets: [
        {
          label: "Entradas",
          data: entradas,
          borderColor: "#22c55e",
          backgroundColor: "rgba(34,197,94,0.2)",
          tension: 0.3
        },
        {
          label: "Saídas",
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
      plugins: {
        legend: { position: "top" }
      }
    }
  });
}

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
    `<option value="">Selecione o cartão</option>` +
    cartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join("");
}

const dashboardDiv = document.querySelector("#dashboard");

async function carregarDashboard(){

  const mes = filtroMes.value;

  const d = await api(`/api/dashboard?mes=${mes}`).then(r=>r.json());

  dashboardDiv.innerHTML = `
    <p><b>Saldo atual:</b> ${money(d.saldo)}</p>
    <p><b>Entradas do mês:</b> ${money(d.entradas)}</p>
    <p><b>Saídas do mês:</b> ${money(d.saidas)}</p>
    <p><b>Fatura do cartão:</b> ${money(d.fatura)}</p>
  `;
}

// MOSTRAR / ESCONDER AREA DE CARTÃO
function toggleCartaoUI() {
  if (!origemInput || !areaCartao) return;
  areaCartao.classList.toggle("mostrar", origemInput.value === "cartao_credito");
}

// executa quando mudar o select
if (origemInput) {
  origemInput?.addEventListener("change", toggleCartaoUI);
}

// executa quando abrir a página
toggleCartaoUI();
origemInput?.addEventListener("change", toggleCartaoUI);
toggleCartaoUI(); // já aplica ao abrir a página

if (dataInput) {
  dataInput.valueAsDate = new Date();
}

async function carregarRelatorioCategorias() {
  if (!metasBody) return;

  const mes = (filtroMes && filtroMes.value) ? filtroMes.value : null;
  if (!mes) { metasBody.innerHTML = ""; return; }

  const dados = await api(`/api/relatorio-categorias?mes=${encodeURIComponent(mes)}`).then(r => r.json());

  metasBody.innerHTML = dados.map(x => {

    const perc = x.meta > 0
      ? ((x.total_saidas / x.meta) * 100).toFixed(0)
      : 0;

    const alerta = perc >= 100 ? "⚠" : "";

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

async function carregarCategorias() {
  const cats = await api("/api/categorias").then(r => r.json());

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
lista?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const action = btn.dataset.action;
  const id = Number(btn.dataset.id);

  if (action === "del") {
    if (!confirm("Excluir essa transação?")) return;
    await api(`/api/movimentacoes/${id}`, { method: "DELETE" });
    await refreshTudo();
    return;
  }

  if (action === "edit") {
    // pega a transação atual pra preencher o form
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
  await carregarCategoriasMeta();
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
  const cats = await api("/api/categorias").then(r => r.json());
  rCat.innerHTML = cats.map(c => `<option value="${c.id}">${c.nome}</option>`).join("");
}

async function carregarResumoRecorrencias() {
  if (!resumoRec) return;
  const r = await api("/api/recorrencias/resumo").then(x => x.json());
  resumoRec.innerHTML = `
    <b>Só recorrências ativas:</b>
    Entradas ${money(r.entradas)} | Saídas ${money(r.saidas)} | Saldo ${money(r.saldo)}
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
    if (!confirm("Excluir essa recorrência?")) return;
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

  if (!filtroMes) return;

  const mes = filtroMes.value;

  const r = await api(`/api/resumo?mes=${mes}`);
  const dados = await r.json();

  if (!resumoDiv) return;

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

  const dados = await api(`/api/relatorio-categorias?mes=${encodeURIComponent(mes)}`).then(r => r.json());

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

  const p = await api(`/api/previsao?mes=${encodeURIComponent(filtroMes.value)}`).then(r => r.json());

  previsaoDiv.innerHTML = `
    <b>Saldo atual:</b> ${money(p.saldo_atual)}<br/>
    <b>Entradas previstas:</b> ${money(p.entradas_previstas)}<br/>
    <b>Saídas previstas:</b> ${money(p.saidas_previstas)}<br/>
    <b>Saldo previsto (fim do mês):</b> ${money(p.saldo_previsto)}
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
btnFat?.addEventListener("click", carregarFatura);

async function carregarMetas(){
  const mes = filtroMes.value;
  const dados = await api(`/api/metas?mes=${mes}`).then(r=>r.json());

  metasBody.innerHTML = dados.map(m => {

    const perc = m.valor_meta > 0
      ? ((m.gasto_mes / m.valor_meta) * 100).toFixed(0)
      : 0;

    const alerta = perc > 100 ? "⚠" : "";

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
      <span>Disponível</span>
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

  if (typeof carregarTransacoes === "function") await carregarTransacoes();
  if (typeof carregarResumo === "function") await carregarResumo();
  if (typeof carregarRelatorioCategorias === "function") await carregarRelatorioCategorias();
  if (typeof carregarGraficoCategorias === "function") await carregarGraficoCategorias();
  if (typeof carregarPrevisao === "function") await carregarPrevisao();
  if (typeof carregarFatura === "function") await carregarFatura();
  if (typeof carregarDashboard === "function") await carregarDashboard();
  if (typeof carregarControleCartao === "function") await carregarControleCartao();
  if (typeof carregarGraficoMensal === "function") await carregarGraficoMensal();
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

if (fatMes) fatMes.value = mesAtualYYYYMM();
if (ccData) ccData.valueAsDate = new Date();

async function carregarCartoes() {
  const cartoes = await api("/api/cartoes").then(r => r.json());
  const opts = cartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join("");
  if (ccCartao) ccCartao.innerHTML = opts;
  if (fatCartao) fatCartao.innerHTML = opts;
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
  await api("/api/cartoes", {
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
  alert("Compra lançada e parcelas geradas!");
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

document?.addEventListener("DOMContentLoaded", () => {

  if (typeof setMesAtualFatura === "function") {
    setMesAtualFatura();
  }

  if (typeof refreshTudo === "function") {
    refreshTudo();
  }

});

(async function initCartao() {
  if (!formCartao && !formCompra) return;
  await carregarCategoriasCartao();
  await carregarCartoes();
  await carregarFatura();
})();

const modalCartao = document.getElementById("modalCartao");
const abrirModalCartao = document.getElementById("abrirModalCartao");
const fecharModalCartao = document.getElementById("fecharModalCartao");

abrirModalCartao?.addEventListener("click", () => {
  modalCartao.style.display = "flex";
});

fecharModalCartao?.addEventListener("click", () => {
  modalCartao.style.display = "none";
});

window.addEventListener("click", (e) => {
  if (e.target === modalCartao) {
    modalCartao.style.display = "none";
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    modalCartao.style.display = "none";
  }
});

const modalRec = document.getElementById("modalRec");
const abrirModalRec = document.getElementById("abrirModalRec");
const fecharModalRec = document.getElementById("fecharModalRec");

abrirModalRec?.addEventListener("click", () => {
  modalRec.style.display = "flex";
});

fecharModalRec?.addEventListener("click", () => {
  modalRec.style.display = "none";
});

window.addEventListener("click", (e) => {
  if (e.target === modalRec) {
    modalRec.style.display = "none";
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    modalRec.style.display = "none";
  }
});
const btnPDF = document.getElementById("btnPDF");

btnPDF?.addEventListener("click", () => {
  const mes = filtroMes.value;

  if (!mes) {
    alert("Selecione um mês");
    return;
  }

  window.open(`/api/relatorio-pdf?mes=${mes}&token=${token}`, "_blank");
});

const btnPagarFatura = document.querySelector("#btnPagarFatura");

btnPagarFatura?.addEventListener("click", async () => {

  const cartaoId = fatCartao.value;
  const mes = fatMes.value;

  if(!confirm("Confirmar pagamento da fatura?")) return;

  await api(`/api/cartoes/${cartaoId}/pagar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mes })
  });

  alert("Fatura paga!");

  await refreshTudo();
});



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
      p.status === "paga" ? "✔" :
      p.status === "aberta" ? "⏳" :
      "•";

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

function logout() {
  localStorage.removeItem("token");
  window.location.href = "/login.html";
}