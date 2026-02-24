const lista = document.querySelector("#lista");
const form = document.querySelector("#form");
const resumoDiv = document.querySelector("#resumo");
const relCats = document.querySelector("#relCats");

const filtroMes = document.querySelector("#filtroMes");
const idInput = document.querySelector("#id");
const descricaoInput = document.querySelector("#descricao");
const valorInput = document.querySelector("#valor");
const tipoInput = document.querySelector("#tipo");
const categoriaSelect = document.querySelector("#categoria");
const dataInput = document.querySelector("#data");

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
  categoriaSelect.innerHTML = cats.map(c => `<option value="${c.id}">${c.nome}</option>`).join("");
}

filtroMes?.addEventListener("input", async () => {
  await carregarTransacoes();
  await carregarResumo();
  await carregarRelatorioCategorias();
});

async function carregarTransacoes() {

  let url = "/api/transacoes";
if (filtroMes && filtroMes.value) url += "?mes=" + filtroMes.value;
console.log("BUSCANDO:", url);
const trans = await fetch(url).then(r => r.json());

  lista.innerHTML = trans.map(t => `
    <tr>
      <td>${t.data}</td>
      <td>${t.descricao}</td>
      <td>${t.categoria ?? "-"}</td>
      <td>${t.tipo}</td>
      <td>${money(t.valor)}</td>
      <td>
        <button data-action="edit" data-id="${t.id}">Editar</button>
        <button data-action="del" data-id="${t.id}">Excluir</button>
      </td>
    </tr>
  `).join("");
  await carregarResumo();
}

// Delegação de eventos pros botões da tabela
lista.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const action = btn.dataset.action;
  const id = Number(btn.dataset.id);

  if (action === "del") {
    if (!confirm("Excluir essa transação?")) return;
    await fetch(`/api/transacoes/${id}`, { method: "DELETE" });
    await carregarTransacoes();
    return;
  }

  if (action === "edit") {
    // pega a transação atual pra preencher o form
    const trans = await fetch("/api/transacoes").then(r => r.json());
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

  const body = {
    descricao: descricaoInput.value,
    valor: Number(valorInput.value),
    tipo: tipoInput.value,
    categoria_id: Number(categoriaSelect.value),
    data: dataInput.value
  };

  const id = idInput.value ? Number(idInput.value) : null;

  if (id) {
    // EDITAR
    await fetch(`/api/transacoes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } else {
    // CRIAR
    await fetch("/api/transacoes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  // limpa form e recarrega
  form.reset();
  idInput.value = "";
  dataInput.valueAsDate = new Date();

  await carregarTransacoes();
});

(async function init() {
  await carregarCategorias();
  await carregarTransacoes();
  await carregarResumo();
  await carregarRelatorioCategorias();
})();
// ====== RECORRÊNCIAS (visualização/teste) ======
const formRec = document.querySelector("#formRec");
const listaRec = document.querySelector("#listaRec");
const rDesc = document.querySelector("#r_descricao");
const rValor = document.querySelector("#r_valor");
const rTipo = document.querySelector("#r_tipo");
const rCat = document.querySelector("#r_categoria");
const rDia = document.querySelector("#r_dia");
const rMes = document.querySelector("#r_mes");
const btnGerar = document.querySelector("#btnGerar");

function mesAtualYYYYMM() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
if (rMes) rMes.value = mesAtualYYYYMM();

async function carregarCategoriasRec() {
  const cats = await fetch("/api/categorias").then(r => r.json());
  rCat.innerHTML = cats.map(c => `<option value="${c.id}">${c.nome}</option>`).join("");
}

async function carregarRecorrencias() {
  const recs = await fetch("/api/recorrencias").then(r => r.json());
  listaRec.innerHTML = recs.map(r => `
    <tr>
      <td>${r.dia_mes}</td>
      <td>${r.descricao}</td>
      <td>${r.categoria ?? "-"}</td>
      <td>${r.tipo}</td>
      <td>R$ ${Number(r.valor).toFixed(2)}</td>
      <td>${r.ativo ? "Sim" : "Não"}</td>
    </tr>
  `).join("");
}

formRec?.addEventListener("submit", async (e) => {
  e.preventDefault();

  await fetch("/api/recorrencias", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      descricao: rDesc.value,
      valor: Number(rValor.value),
      tipo: rTipo.value,
      categoria_id: Number(rCat.value),
      dia_mes: Number(rDia.value),
    })
  });

  formRec.reset();
  await carregarRecorrencias();
});

btnGerar?.addEventListener("click", async () => {
  const mes = rMes.value.trim(); // YYYY-MM
  const resp = await fetch(`/api/recorrencias/gerar?mes=${encodeURIComponent(mes)}`, { method: "POST" })
    .then(r => r.json());

  alert(`Criadas: ${resp.criadas}`);
  // recarrega transações (se você tiver a função)
  if (typeof carregarTransacoes === "function") await carregarTransacoes();
});

// chame isso no seu init()
(async function initRec() {
  if (!formRec) return;
  await carregarCategoriasRec();
  await carregarRecorrencias();
})();

async function carregarResumo(){
  const r = await fetch("/api/resumo").then(x => x.json());
  resumoDiv.innerHTML = `
    <b>Saldo total:</b> ${money(r.saldo)} |
    <b>Entradas:</b> ${money(r.entradas)} |
    <b>Saídas:</b> ${money(r.saidas)}
  `;
}