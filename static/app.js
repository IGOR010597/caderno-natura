const state = { rows: [], imageFile: null, generated: null, generatedFile: null };
let deferredInstallPrompt = null;
const $ = (selector) => document.querySelector(selector);
const sections = [$("#inicio"), $("#reviewSection"), $("#successSection"), $("#historySection")];

function showSection(element) {
  sections.forEach((section) => section.classList.toggle("hidden", section !== element));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 3800);
}

function setLoading(active, title = "Lendo a foto…", text = "Identificando códigos e quantidades") {
  $("#loadingTitle").textContent = title;
  $("#loadingText").textContent = text;
  $("#loading").classList.toggle("hidden", !active);
}

function rowIsValid(row) {
  return /^\d+$/.test(String(row.code || "").trim()) && Number.isInteger(Number(row.quantity)) && Number(row.quantity) > 0;
}

function refreshReviewState() {
  const invalidCount = state.rows.filter((row) => !rowIsValid(row)).length;
  const notice = $("#reviewNotice");
  $("#rowCount").textContent = state.rows.length;
  $("#emptyRows").classList.toggle("hidden", state.rows.length > 0);
  notice.classList.toggle("hidden", invalidCount === 0);
  notice.textContent = invalidCount ? `${invalidCount} linha${invalidCount > 1 ? "s precisam" : " precisa"} de correção antes de gerar a planilha.` : "";
  const canGenerate = state.rows.length > 0 && invalidCount === 0 && $("#reviewConfirmed").checked;
  $("#generateButton").disabled = !canGenerate;
}

function renderRows() {
  const container = $("#productRows");
  container.innerHTML = "";
  state.rows.forEach((row, index) => {
    const valid = rowIsValid(row);
    const element = document.createElement("div");
    element.className = "product-row";

    const code = document.createElement("input");
    code.className = `code-input${/^\d+$/.test(String(row.code || "").trim()) ? "" : " invalid"}`;
    code.value = row.code || "";
    code.inputMode = "numeric";
    code.placeholder = "Ex.: 123456";
    code.setAttribute("aria-label", `Código do produto ${index + 1}`);

    const quantity = document.createElement("input");
    quantity.className = `qty-input${Number(row.quantity) > 0 ? "" : " invalid"}`;
    quantity.value = row.quantity ?? "";
    quantity.type = "number";
    quantity.inputMode = "numeric";
    quantity.min = "1";
    quantity.step = "1";
    quantity.placeholder = "Qtd.";
    quantity.setAttribute("aria-label", `Quantidade do produto ${index + 1}`);

    const status = document.createElement("span");
    status.className = `status ${valid ? "ok" : "review"}`;
    status.textContent = valid ? "OK" : "Revisar";

    const actions = document.createElement("div");
    actions.className = "row-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.title = "Excluir linha";
    remove.setAttribute("aria-label", `Excluir produto ${index + 1}`);
    remove.textContent = "✕";
    actions.append(remove);

    element.append(code, quantity, status, actions);
    if (row.raw_line && !valid) {
      const raw = document.createElement("p");
      raw.className = "raw-line";
      raw.innerHTML = `<b>OCR leu:</b> ${escapeHtml(row.raw_line)}`;
      element.append(raw);
    }

    code.addEventListener("input", () => {
      state.rows[index].code = code.value.trim();
      state.rows[index].raw_line = "";
      renderRows();
      document.querySelectorAll(".code-input")[index]?.focus();
    });
    quantity.addEventListener("change", () => {
      state.rows[index].quantity = quantity.value === "" ? null : Number(quantity.value);
      state.rows[index].raw_line = "";
      renderRows();
    });
    remove.addEventListener("click", () => {
      state.rows.splice(index, 1);
      $("#reviewConfirmed").checked = false;
      renderRows();
    });
    container.append(element);
  });
  refreshReviewState();
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

async function processImage(file) {
  if (!file) return;
  state.imageFile = file;
  if (file.size > 15 * 1024 * 1024) return showToast("A imagem deve ter no máximo 15 MB.");
  setLoading(true, "Preparando a foto…", "Reduzindo o tamanho para uma leitura mais rápida");
  const data = new FormData();
  try {
    const uploadFile = await compressImage(file);
    data.append("image", uploadFile, "foto-caderno.jpg");
    setLoading(true, "Lendo a foto com IA…", "Identificando códigos e quantidades manuscritos");
    const response = await fetch("/api/ocr", { method: "POST", body: data });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Não foi possível ler a foto.");
    state.rows = result.rows;
    $("#reviewConfirmed").checked = false;
    renderRows();
    showSection($("#reviewSection"));
    if (result.warning) showToast(result.warning);
    if (!state.rows.length) showToast("O OCR não encontrou linhas. Você pode adicioná-las manualmente.");
  } catch (error) {
    state.rows = [];
    renderRows();
    showSection($("#reviewSection"));
    showToast(`${error.message} Você ainda pode digitar os produtos manualmente.`);
  } finally {
    setLoading(false);
    $("#cameraInput").value = "";
    $("#galleryInput").value = "";
  }
}

async function compressImage(file) {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const maxDimension = 1800;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000 && file.type === "image/jpeg") {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Falha ao preparar imagem.")), "image/jpeg", .84)
    );
    return new File([blob], "foto-caderno.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

async function generateSpreadsheet() {
  if (!$("#reviewConfirmed").checked || state.rows.some((row) => !rowIsValid(row))) return;
  setLoading(true, "Gerando a planilha…", "Aplicando o modelo de importação Natura");
  try {
    const response = await fetch("/api/spreadsheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        review_confirmed: true,
        products: state.rows.map((row) => ({ code: String(row.code).trim(), quantity: Number(row.quantity) })),
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Não foi possível gerar a planilha.");
    state.generated = result;
    state.generatedFile = null;
    try {
      const fileResponse = await fetch(result.download_url);
      if (!fileResponse.ok) throw new Error("Arquivo indisponível.");
      const blob = await fileResponse.blob();
      state.generatedFile = new File([blob], result.filename, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
    } catch {
      // The regular download link remains available if preloading is not possible.
    }
    $("#successFilename").textContent = result.filename;
    $("#successSummary").textContent = `${result.product_count} produtos • ${result.unit_count} unidades`;
    $("#downloadButton").href = result.download_url;
    updateShareButton();
    showSection($("#successSection"));
  } catch (error) {
    showToast(error.message);
  } finally {
    setLoading(false);
  }
}

function canShareGeneratedFile() {
  return Boolean(
    state.generatedFile &&
    navigator.share &&
    navigator.canShare?.({ files: [state.generatedFile] })
  );
}

function updateShareButton() {
  const supported = canShareGeneratedFile();
  $("#shareButton").textContent = supported
    ? "Compartilhar no WhatsApp"
    : "Baixar para enviar no WhatsApp";
  $("#shareHint").textContent = supported
    ? "O menu do celular será aberto. Escolha WhatsApp."
    : "Seu navegador não permite anexar Excel diretamente. O arquivo será baixado para você anexar no WhatsApp.";
  $("#shareHint").classList.remove("hidden");
}

function shareSpreadsheet() {
  if (!state.generated) return;
  if (!canShareGeneratedFile()) {
    $("#downloadButton").click();
    showToast("Planilha baixada. No WhatsApp, toque no clipe e escolha Documento.");
    return;
  }

  // Calling share without an awaited fetch preserves the mobile user gesture permission.
  navigator.share({ files: [state.generatedFile] }).catch((error) => {
    if (error.name !== "AbortError") {
      const reason = error.name === "NotAllowedError"
        ? "O Android bloqueou este tipo de compartilhamento."
        : "Não foi possível abrir o compartilhamento.";
      showToast(`${reason} Use “Baixar planilha” e envie como Documento no WhatsApp.`);
    }
  });
}

async function showHistory() {
  showSection($("#historySection"));
  const list = $("#historyList");
  list.innerHTML = '<div class="empty-state"><span>Carregando histórico…</span></div>';
  try {
    const response = await fetch("/api/history");
    if (!response.ok) throw new Error();
    const items = await response.json();
    if (!items.length) {
      list.innerHTML = '<div class="empty-state"><strong>Nenhuma planilha ainda</strong><span>As planilhas geradas aparecerão aqui.</span></div>';
      return;
    }
    list.innerHTML = "";
    items.forEach((item) => {
      const link = document.createElement("a");
      link.className = "history-item";
      link.href = `/api/spreadsheets/${item.id}/download`;
      link.innerHTML = `<div class="excel-icon">X</div><div><strong>${escapeHtml(item.filename)}</strong><span>${formatDate(item.created_at)} • ${item.product_count} produtos • ${item.unit_count} unidades</span></div><b>Baixar ↓</b>`;
      list.append(link);
    });
  } catch {
    list.innerHTML = '<div class="notice warning">Não foi possível carregar o histórico.</div>';
  }
}

function formatDate(value) {
  const date = new Date(value);
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function isAppInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function showInstallPrompt(ios = false, manual = false) {
  if (isAppInstalled()) return;
  $("#iosInstallHint").classList.toggle("hidden", !ios);
  $("#manualInstallHint").classList.toggle("hidden", ios || !manual);
  $("#installAppButton").classList.toggle("hidden", ios || manual);
  $("#installDescription").textContent = ios
    ? "No iPhone, a instalação é feita pelo menu de compartilhamento do Safari."
    : manual
      ? "Seu navegador oferece a instalação pelo menu principal."
      : "Use como aplicativo, direto da tela inicial e sem precisar procurar o endereço novamente.";
  $("#installPrompt").classList.remove("hidden");
}

function hideInstallPrompt() {
  $("#installPrompt").classList.add("hidden");
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  showInstallPrompt(false, false);
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  $("#installPrompt").classList.add("hidden");
  $("#installTop").classList.add("hidden");
  localStorage.setItem("naturaAppInstalled", "1");
  showToast("Aplicativo instalado com sucesso!");
});

$("#cameraButton").addEventListener("click", () => $("#cameraInput").click());
$("#galleryButton").addEventListener("click", () => $("#galleryInput").click());
$("#cameraInput").addEventListener("change", (event) => processImage(event.target.files[0]));
$("#galleryInput").addEventListener("change", (event) => processImage(event.target.files[0]));
$("#historyButton").addEventListener("click", showHistory);
$("#historyTop").addEventListener("click", showHistory);
$("#historyBack").addEventListener("click", () => showSection($("#inicio")));
$("#backButton").addEventListener("click", () => showSection($("#inicio")));
$("#addRowButton").addEventListener("click", () => {
  state.rows.push({ code: "", quantity: null, status: "Revisar", raw_line: "" });
  $("#reviewConfirmed").checked = false;
  renderRows();
  document.querySelectorAll(".code-input")[state.rows.length - 1]?.focus();
});
$("#reprocessButton").addEventListener("click", () => state.imageFile ? processImage(state.imageFile) : showToast("Selecione uma foto primeiro."));
$("#reviewConfirmed").addEventListener("change", refreshReviewState);
$("#generateButton").addEventListener("click", generateSpreadsheet);
$("#shareButton").addEventListener("click", shareSpreadsheet);
$("#newOrderButton").addEventListener("click", () => {
  state.rows = []; state.imageFile = null; state.generated = null; state.generatedFile = null;
  $("#reviewConfirmed").checked = false;
  showSection($("#inicio"));
});
$("#installAppButton").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return showToast("Use o menu do navegador e escolha “Instalar aplicativo”.");
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $("#installPrompt").classList.add("hidden");
});
$("#installClose").addEventListener("click", hideInstallPrompt);
$("#installLater").addEventListener("click", hideInstallPrompt);
$("#installTop").addEventListener("click", () => {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  showInstallPrompt(isIos, !isIos && !deferredInstallPrompt);
});

window.addEventListener("load", () => {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isAppInstalled()) {
    $("#installTop").classList.add("hidden");
    return;
  }
  setTimeout(() => showInstallPrompt(isIos, !isIos && !deferredInstallPrompt), 900);
});

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/static/sw.js"));
