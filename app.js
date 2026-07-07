import { app, db } from "./firebase.js";
import { flags } from "./flags.js";
import { matches as localMatches } from "./matches.js";

import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
    collection,
    doc,
    onSnapshot,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const btnLogin = document.getElementById("btnLogin");
const btnLogout = document.getElementById("btnLogout");
const btnSave = document.getElementById("btnSave");
const userInfo = document.getElementById("userInfo");
const status = document.getElementById("status");
const selectionPanel = document.getElementById("selectionPanel");
const availableTeams = document.getElementById("availableTeams");
const selectedTeams = document.getElementById("selectedTeams");
const availableCount = document.getElementById("availableCount");
const selectedCount = document.getElementById("selectedCount");
const bracketContainer = document.getElementById("bracketContainer");
const aporteMonto = document.getElementById("aporteMonto");
const participantsCount = document.getElementById("participantsCount");
const participantsList = document.getElementById("participantsList");
const rankingCount = document.getElementById("rankingCount");
const rankingList = document.getElementById("rankingList");
const LIMITE_EQUIPOS = 4;
const APORTE_DEFAULT = 10;
const BONOS_CAMPEON = [4, 3, 2, 0];
const CIERRE_SELECCIONES = new Date("2026-07-04T12:00:00-05:00");

let currentUser = null;
let seleccion = {};
let ordenSeleccion = [];
let matches = { ...localMatches };
let faseActiva = "Llave";
let unsubscribeSeleccion = null;
let seleccionGuardada = {};
let ordenGuardado = [];
let participantes = [];
let cierreManual = false;

btnLogin.onclick = async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch (e) {
        console.error(e);
        status.textContent = e.message;
    }
};

btnLogout.onclick = () => signOut(auth);
btnSave.onclick = () => guardarSeleccion();

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function googlePhotoURL(user) {
    return user?.providerData?.find(provider => provider.providerId === "google.com")?.photoURL
        || user?.photoURL
        || "";
}

function datosPerfilUsuario(user) {
    return {
        uid: user.uid,
        nombre: user.displayName || user.email,
        email: user.email,
        photoURL: googlePhotoURL(user)
    };
}

function seleccionesCerradas() {
    return cierreManual || Date.now() >= CIERRE_SELECCIONES.getTime();
}

function mensajeCierre() {
    return "La selección está cerrada desde el sábado 4 de julio de 2026, 12:00 p. m. hora peruana.";
}

function renderUser(user) {
    const nombre = user.displayName || user.email;
    const inicial = (nombre || "?").trim().charAt(0).toUpperCase();
    const photoURL = googlePhotoURL(user);
    const avatar = photoURL
        ? `<img class="avatar" src="${escapeHtml(photoURL)}" alt="${escapeHtml(nombre)}" referrerpolicy="no-referrer">`
        : `<span class="avatar avatar-fallback">${escapeHtml(inicial)}</span>`;

    userInfo.innerHTML = `
        ${avatar}
        <span>
            <strong>${escapeHtml(nombre)}</strong>
            <small>${escapeHtml(user.email)}</small>
        </span>
    `;
}

function formatSoles(value) {
    const monto = Number(value);
    const aporte = Number.isFinite(monto) ? monto : APORTE_DEFAULT;

    return `S/. ${aporte.toFixed(2)}`;
}

function renderAporte(value = APORTE_DEFAULT) {
    aporteMonto.textContent = formatSoles(value);
}

function aporteDesdeConfig(data) {
    return data?.aporte
        ?? data?.aportes
        ?? data?.monto
        ?? data?.montoAporte
        ?? data?.cuota
        ?? data?.inscripcion
        ?? data?.precio
        ?? data?.valor;
}

function iniciarConfig() {
    renderAporte();

    onSnapshot(doc(db, "config", "pollaOctavos"), snapshot => {
        if (!snapshot.exists()) {
            renderAporte();
            cierreManual = false;
            render();
            return;
        }

        const data = snapshot.data();
        const aporte = aporteDesdeConfig(data);
        cierreManual = data.seleccionesCerradas === true || data.cerrado === true || data.closed === true;

        if (aporte !== undefined && aporte !== null && aporte !== "") {
            renderAporte(aporte);
        } else {
            renderAporte();
        }

        render();
    }, () => {
        renderAporte();
        cierreManual = false;
        render();
    });
}

function equiposEnOpcion(opcion) {
    return String(opcion || "")
        .split(" / ")
        .map(equipo => equipo.trim())
        .filter(Boolean);
}

function equipoDesdeReferencia(ref) {
    if (!ref) return null;

    if (String(ref).startsWith("Perdedor ")) {
        return perdedorPartido(String(ref).replace("Perdedor ", ""));
    }

    const match = matches[ref];

    if (match) {
        return match.winner || null;
    }

    return ref;
}

function equiposDelCruce(match) {
    if (!match) return [];

    return [
        equipoDesdeReferencia(match.team1),
        equipoDesdeReferencia(match.team2)
    ];
}

function perdedorPartido(matchId) {
    const match = matches[matchId];

    if (!match?.winner) return null;

    const [equipo1, equipo2] = equiposDelCruce(match);

    if (equipo1 === match.winner) return equipo2;
    if (equipo2 === match.winner) return equipo1;

    return null;
}

function posicionesMundial() {
    return {
        campeon: matches.F1?.winner || null,
        subcampeon: perdedorPartido("F1"),
        tercero: matches.TercerLugar?.winner || null,
        cuarto: perdedorPartido("TercerLugar"),
        clasificadosCuartos: ["O1", "O2", "O3", "O4", "O5", "O6", "O7", "O8"]
            .map(matchId => matches[matchId])
            .filter(match => match?.winner && estaFinalizado(match))
            .map(match => match.winner)
            .filter(Boolean)
    };
}

function puntajeEquipo(equipo, orden) {
    const posiciones = posicionesMundial();

    if (posiciones.campeon === equipo) {
        return 10 + (BONOS_CAMPEON[orden] || 0);
    }

    if (posiciones.subcampeon === equipo) return 7;
    if (posiciones.tercero === equipo) return 5;
    if (posiciones.cuarto === equipo) return 3;
    if (posiciones.clasificadosCuartos.includes(equipo)) return 1;

    return 0;
}

function puntajeOpcion(opcion, orden) {
    return equiposEnOpcion(opcion)
        .map(equipo => puntajeEquipo(equipo, orden))
        .reduce((mayor, puntos) => Math.max(mayor, puntos), 0);
}

function equiposIncluyen(equipos, equipo) {
    return equipos.filter(Boolean).includes(equipo);
}

function equipoYaNoPuedeSumar(equipo) {
    if (!equipo) return false;

    const final = matches.F1;
    const tercerLugar = matches.TercerLugar;

    if (estaFinalizado(final) && equiposIncluyen(equiposDelCruce(final), equipo)) {
        return true;
    }

    if (estaFinalizado(tercerLugar) && equiposIncluyen(equiposDelCruce(tercerLugar), equipo)) {
        return true;
    }

    return Object.values(matches).some(match => {
        if (!estaFinalizado(match) || !match.winner) {
            return false;
        }

        if (!equiposIncluyen(equiposDelCruce(match), equipo) || match.winner === equipo) {
            return false;
        }

        return match.fase !== "Semifinal";
    });
}

function opcionCerrada(opcion) {
    const equipos = equiposEnOpcion(opcion);

    return equipos.length > 0 && equipos.every(equipoYaNoPuedeSumar);
}

function puntajesParticipante(participante) {
    const detalle = participante.opciones.map((equipo, index) => ({
        equipo,
        puntos: puntajeOpcion(equipo, index)
    }));
    const total = detalle.reduce((suma, item) => suma + item.puntos, 0);

    return { detalle, total };
}

function renderRanking() {
    rankingCount.textContent = String(participantes.length);

    if (participantes.length === 0) {
        rankingList.innerHTML = `
            <li class="ranking-empty">Todavía no hay participantes registrados.</li>
        `;
        return;
    }

    const ranking = participantes
        .map(participante => ({
            ...participante,
            puntos: puntajesParticipante(participante).total
        }))
        .sort((a, b) => b.puntos - a.puntos || a.nombre.localeCompare(b.nombre, "es"));

    rankingList.innerHTML = ranking.map((participante, index) => {
        const inicial = participante.nombre.trim().charAt(0).toUpperCase() || "?";
        const esActual = currentUser?.uid === participante.uid;
        const photoURL = esActual
            ? googlePhotoURL(currentUser) || participante.photoURL
            : participante.photoURL;
        const avatar = photoURL
            ? `<img class="participant-avatar" src="${escapeHtml(photoURL)}" alt="${escapeHtml(participante.nombre)}" referrerpolicy="no-referrer">`
            : `<span class="participant-avatar">${escapeHtml(inicial)}</span>`;

        return `
            <li class="ranking-item ${esActual ? "is-current" : ""}">
                <span class="position">${index + 1}</span>
                ${avatar}
                <span class="participant-info">
                    <strong>${escapeHtml(participante.nombre)}</strong>
                    <small>${participante.total}/${LIMITE_EQUIPOS} selecciones</small>
                </span>
                <strong class="ranking-score">${participante.puntos} pts</strong>
            </li>
        `;
    }).join("");
}

function renderParticipantes() {
    participantsCount.textContent = String(participantes.length);

    if (participantes.length === 0) {
        participantsList.innerHTML = `
            <li class="participant-empty">Todavía no hay participantes registrados.</li>
        `;
        renderRanking();
        return;
    }

    participantsList.innerHTML = participantes.map(participante => {
        const puntajes = puntajesParticipante(participante);
        const inicial = participante.nombre.trim().charAt(0).toUpperCase() || "?";
        const esActual = currentUser?.uid === participante.uid;
        const photoURL = esActual
            ? googlePhotoURL(currentUser) || participante.photoURL
            : participante.photoURL;
        const avatar = photoURL
            ? `<img class="participant-avatar" src="${escapeHtml(photoURL)}" alt="${escapeHtml(participante.nombre)}" referrerpolicy="no-referrer">`
            : `<span class="participant-avatar">${escapeHtml(inicial)}</span>`;
        const opciones = participante.opciones.length > 0
            ? participante.opciones.map((equipo, index) => {
                const cerrada = opcionCerrada(equipo);

                return `
                <li class="participant-pick ${cerrada ? "is-locked" : ""}">
                    <span class="position">${index + 1}</span>
                    ${teamOptionHtml(equipo)}
                    <strong class="participant-points">${puntajes.detalle[index]?.puntos || 0} pts</strong>
                </li>
            `;
            }).join("")
            : `<li class="participant-pick is-empty">Sin selecciones guardadas.</li>`;

        return `
            <li class="participant-item ${esActual ? "is-current" : ""}">
                <div class="participant-head">
                    ${avatar}
                    <span class="participant-info">
                        <strong>${escapeHtml(participante.nombre)}</strong>
                        <small>${escapeHtml(participante.email || "Sin correo")}</small>
                    </span>
                    <span class="participant-status">${puntajes.total} pts</span>
                </div>
                <ol class="participant-picks">${opciones}</ol>
            </li>
        `;
    }).join("");

    renderRanking();
}

function participanteDesdeSnapshot(item) {
    const data = item.data();
    const picks = data.picks || seleccionDesdeEquipos(data.equipos || []);
    const orden = ordenDesdeDatos(data.orden, data.equipos || [], picks);
    const normalizada = normalizarSeleccion(picks, orden);
    const nombre = data.nombre || data.email || "Participante";

    return {
        uid: data.uid || item.id,
        nombre,
        email: data.email || "",
        photoURL: data.photoURL || "",
        opciones: normalizada.orden.map(matchId => normalizada.picks[matchId]),
        total: normalizada.orden.length
    };
}

function iniciarParticipantes() {
    renderParticipantes();

    onSnapshot(collection(db, "seleccionesOctavos"), snapshot => {
        participantes = snapshot.docs
            .map(participanteDesdeSnapshot)
            .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

        renderParticipantes();
    }, error => {
        console.error(error);
        participantsList.innerHTML = `
            <li class="participant-empty">No se pudieron cargar los participantes.</li>
        `;
    });
}

function aplicarSeleccion(picks, orden, persistida = true) {
    seleccion = { ...picks };
    ordenSeleccion = [...orden];

    if (persistida) {
        seleccionGuardada = { ...picks };
        ordenGuardado = [...orden];
    }

    render();
}

function restaurarSeleccionGuardada() {
    seleccion = { ...seleccionGuardada };
    ordenSeleccion = [...ordenGuardado];
}

function normalizarSeleccion(picks, orden) {
    const ordenNormalizado = [];
    const picksNormalizados = {};

    function agregar(matchId) {
        if (ordenNormalizado.length >= LIMITE_EQUIPOS || ordenNormalizado.includes(matchId)) {
            return;
        }

        const match = octavos().find(item => item.id === matchId);
        const equipo = picks?.[matchId];

        if (!match || !equiposDelPartido(match).includes(equipo)) {
            return;
        }

        ordenNormalizado.push(matchId);
        picksNormalizados[matchId] = equipo;
    }

    if (Array.isArray(orden)) {
        orden.forEach(agregar);
    }

    octavos().forEach(match => agregar(match.id));

    return {
        picks: picksNormalizados,
        orden: ordenNormalizado
    };
}

function iniciarSeleccion(user) {
    if (unsubscribeSeleccion) {
        unsubscribeSeleccion();
        unsubscribeSeleccion = null;
    }

    seleccionGuardada = {};
    ordenGuardado = [];
    aplicarSeleccion({}, []);

    const ref = doc(db, "seleccionesOctavos", user.uid);

    unsubscribeSeleccion = onSnapshot(ref, { includeMetadataChanges: true }, snapshot => {
        if (currentUser?.uid !== user.uid) {
            return;
        }

        if (!snapshot.exists()) {
            aplicarSeleccion({}, [], !snapshot.metadata.hasPendingWrites);
            return;
        }

        const data = snapshot.data();
        const picks = data.picks || seleccionDesdeEquipos(data.equipos || []);
        const orden = ordenDesdeDatos(data.orden, data.equipos || [], picks);
        const normalizada = normalizarSeleccion(picks, orden);

        aplicarSeleccion(normalizada.picks, normalizada.orden, !snapshot.metadata.hasPendingWrites);
    }, error => {
        if (currentUser?.uid !== user.uid) {
            return;
        }

        console.error(error);
        restaurarSeleccionGuardada();
        status.textContent = "No se pudo cargar tu selección.";
        render();
    });
}

function flagHtml(nombre) {
    const nombres = String(nombre || "").split(" / ");
    const banderas = nombres
        .map(item => flags[item] ? `<img class="flag" src="${flags[item]}" alt="${escapeHtml(item)}">` : "")
        .filter(Boolean)
        .join("");

    return banderas || `<span class="flag-placeholder">🏳️</span>`;
}

function teamOptionHtml(nombre) {
    return `
        <span class="team-name">
            ${flagHtml(nombre)}
            ${escapeHtml(nombre)}
        </span>
    `;
}

function tieneMarcador(match) {
    return match.score1 !== null
        && match.score1 !== undefined
        && match.score2 !== null
        && match.score2 !== undefined;
}

function estaFinalizado(match) {
    return match.finalizado === true;
}

function estadoPartido(match) {
    if (estaFinalizado(match)) {
        return "🏁 Finalizado";
    }

    return tieneMarcador(match) ? "⚽ Con marcador" : "⏳ Pendiente";
}

function claseEstadoPartido(match) {
    if (estaFinalizado(match)) {
        return "is-finalized";
    }

    return tieneMarcador(match) ? "is-scored" : "is-pending";
}

function formatFecha(kickoff) {
    if (!kickoff) return "";

    return new Date(kickoff).toLocaleString("es-PE", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: "America/Lima"
    });
}

function formatDia(kickoff) {
    if (!kickoff) return "Sin fecha";

    return new Date(kickoff).toLocaleDateString("es-PE", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        timeZone: "America/Lima"
    });
}

function resolverEquipo(ref, matches) {
    if (!ref) return "TBD";

    const match = matches[ref];

    if (match) {
        return match.winner || `Ganador ${ref}`;
    }

    return ref;
}

function resolverEquipoParaSeleccion(ref, matches) {
    if (!ref) return "TBD";

    const match = matches[ref];

    if (match) {
        return match.winner || `${resolverEquipoParaSeleccion(match.team1, matches)} / ${resolverEquipoParaSeleccion(match.team2, matches)}`;
    }

    return ref;
}

function octavos() {
    return ["O1", "O2", "O3", "O4", "O5", "O6", "O7", "O8"]
        .map(id => matches[id] ? { id, ...matches[id] } : null)
        .filter(Boolean);
}

function equiposDelPartido(match) {
    return [
        resolverEquipoParaSeleccion(match.team1, matches),
        resolverEquipoParaSeleccion(match.team2, matches)
    ];
}

function seleccionDesdeEquipos(equipos) {
    const picks = {};

    octavos().forEach((match, index) => {
        const equipo = equipos[index];
        const opciones = equiposDelPartido(match);

        if (equipo && opciones.includes(equipo)) {
            picks[match.id] = equipo;
        }
    });

    return picks;
}

function ordenDesdeDatos(orden, equipos, picks = seleccion) {
    if (Array.isArray(orden)) {
        return orden.filter(matchId => picks[matchId]);
    }

    return equipos
        .map(equipo => octavos().find(match => picks[match.id] === equipo)?.id)
        .filter(Boolean);
}

function seleccionesOrdenadas() {
    return ordenSeleccion
        .map(matchId => {
            const match = octavos().find(item => item.id === matchId);
            const equipo = seleccion[matchId];

            if (!match) {
                return null;
            }

            return equiposDelPartido(match).includes(equipo) ? equipo : null;
        })
        .filter(Boolean);
}

function ordenValido() {
    const idsOctavos = new Set(octavos().map(match => match.id));
    const idsUnicos = new Set(ordenSeleccion);

    return ordenSeleccion.length === LIMITE_EQUIPOS
        && idsUnicos.size === LIMITE_EQUIPOS
        && ordenSeleccion.every(matchId => idsOctavos.has(matchId) && seleccion[matchId]);
}

function renderTeam(nombre, score, penalties, isWinner) {
    return `
        <div class="team ${isWinner ? "winner" : ""}">
            <span class="team-name">
                ${flagHtml(nombre)}
                ${escapeHtml(nombre)}
            </span>

            <strong>
                ${score ?? ""}
                ${penalties !== null && penalties !== undefined ? `(${penalties})` : ""}
            </strong>
        </div>
    `;
}

function getMatchTeam(match, side, matches) {
    const team = resolverEquipo(match[side], matches);
    const score = side === "team1" ? match.score1 : match.score2;
    const penalties = side === "team1" ? match.pen1 : match.pen2;
    const isWinner = match.winner === team;

    return { team, score, penalties, isWinner };
}

function renderBracketTeamLine(teamData) {
    const marcador = teamData.score ?? "";
    const penales = teamData.penalties !== null && teamData.penalties !== undefined
        ? ` (${teamData.penalties})`
        : "";

    return `
        <div class="bracket-team-line ${teamData.isWinner ? "winner" : ""}">
            <span>
                ${flagHtml(teamData.team)}
                ${escapeHtml(teamData.team)}
            </span>
            <strong>${marcador}${penales}</strong>
        </div>
    `;
}

function renderBracketNode(match, matches) {
    if (!match) {
        return `
            <div class="bracket-match empty">
                <div class="bracket-match-id">Pendiente</div>
                <div class="bracket-team-line"><span>TBD</span><strong></strong></div>
                <div class="bracket-team-line"><span>TBD</span><strong></strong></div>
            </div>
        `;
    }

    const team1 = getMatchTeam(match, "team1", matches);
    const team2 = getMatchTeam(match, "team2", matches);
    const statusClass = claseEstadoPartido(match);
    const source = matches[match.team1] || matches[match.team2]
        ? `<div class="bracket-source">${escapeHtml(match.team1)} + ${escapeHtml(match.team2)}</div>`
        : "";

    return `
        <div class="bracket-match ${statusClass}">
            <div class="bracket-match-head">
                <div class="bracket-match-id">${escapeHtml(match.id)} · ${escapeHtml(match.fase)}</div>
                <span class="match-status">${estadoPartido(match)}</span>
            </div>
            ${source}
            ${renderBracketTeamLine(team1)}
            ${renderBracketTeamLine(team2)}
        </div>
    `;
}

function renderKnockoutBracket(matches) {
    const lista = Object.entries(matches).map(([id, data]) => ({ id, ...data }));
    const porId = Object.fromEntries(lista.map(match => [match.id, match]));

    const rondas = [
        { title: "16avos", ids: ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10", "L11", "L12", "L13", "L14", "L15", "L16"] },
        { title: "Octavos", ids: ["O1", "O2", "O3", "O4", "O5", "O6", "O7", "O8"] },
        { title: "Cuartos", ids: ["C1", "C2", "C3", "C4"] },
        { title: "Semis", ids: ["S1", "S2"] },
        { title: "Final", ids: ["F1"] }
    ];

    const posiciones = {};
    let hoja = 0;

    function calcularPosicion(id) {
        if (posiciones[id] !== undefined) {
            return posiciones[id];
        }

        const match = porId[id];

        if (!match) {
            posiciones[id] = hoja;
            hoja += 2;
            return posiciones[id];
        }

        const hijos = [match.team1, match.team2].filter(ref => porId[ref]);

        if (hijos.length === 0) {
            posiciones[id] = hoja;
            hoja += 2;
            return posiciones[id];
        }

        const posicionHijos = hijos.map(calcularPosicion);
        posiciones[id] = posicionHijos.reduce((total, posicion) => total + posicion, 0) / posicionHijos.length;

        return posiciones[id];
    }

    calcularPosicion("F1");

    bracketContainer.innerHTML = `
        <div class="knockout-shell">
            <div class="knockout-bracket">
                ${rondas.map(round => `
                    <section class="bracket-round bracket-round-${round.ids.length}">
                        <h3>${round.title}</h3>
                        <div class="bracket-round-matches">
                            ${round.ids.map(id => `
                                <div class="bracket-slot" style="grid-row:${Math.round(posiciones[id] || 0) + 1} / span 2">
                                    ${renderBracketNode(porId[id], matches)}
                                </div>
                            `).join("")}
                        </div>
                    </section>
                `).join("")}
            </div>
        </div>
    `;
}

function renderBracket(matches, fase = "Llave") {
    if (!bracketContainer) return;

    if (Object.keys(matches).length === 0) {
        bracketContainer.innerHTML = `<p class="empty-bracket">No hay partidos cargados todavía.</p>`;
        return;
    }

    if (fase === "Llave") {
        renderKnockoutBracket(matches);
        return;
    }

    let lista = Object.entries(matches)
        .map(([id, data]) => ({ id, ...data }));

    if (fase !== "Todos") {
        lista = lista.filter(m => m.fase === fase);
    }

    lista.sort((a, b) => {
        if (a.kickoff && b.kickoff) {
            return new Date(a.kickoff) - new Date(b.kickoff);
        }

        return a.orden - b.orden;
    });

    const grupos = {};

    lista.forEach(match => {
        const dia = formatDia(match.kickoff);

        if (!grupos[dia]) {
            grupos[dia] = [];
        }

        grupos[dia].push(match);
    });

    bracketContainer.innerHTML = Object.entries(grupos).map(([dia, partidos]) => `
        <div class="match-day">
            <h3>${dia}</h3>

            ${partidos.map(match => {
                const equipo1 = resolverEquipo(match.team1, matches);
                const equipo2 = resolverEquipo(match.team2, matches);
                const statusClass = claseEstadoPartido(match);

                return `
                    <div class="match-card ${statusClass}">
                        <div class="match-card-head">
                            <div class="match-title">${escapeHtml(match.id)} · ${escapeHtml(match.fase)}</div>
                            <span class="match-status">${estadoPartido(match)}</span>
                        </div>
                        <div class="match-date">${formatFecha(match.kickoff)}</div>

                        ${renderTeam(equipo1, match.score1, match.pen1, match.winner === equipo1)}
                        ${renderTeam(equipo2, match.score2, match.pen2, match.winner === equipo2)}
                    </div>
                `;
            }).join("")}
        </div>
    `).join("");
}

function iniciarLlave() {
    document.querySelectorAll(".tab").forEach(button => {
        button.addEventListener("click", () => {
            document.querySelectorAll(".tab").forEach(item => item.classList.remove("active"));
            button.classList.add("active");
            faseActiva = button.dataset.fase;
            renderBracket(matches, faseActiva);
        });
    });

    renderBracket(matches, faseActiva);

    onSnapshot(collection(db, "matches"), snapshot => {
        const firestoreMatches = {};

        snapshot.forEach(item => {
            firestoreMatches[item.id] = item.data();
        });

        matches = Object.keys(firestoreMatches).length > 0
            ? firestoreMatches
            : { ...localMatches };

        renderBracket(matches, faseActiva);
        render();
        renderParticipantes();
    }, () => {
        matches = { ...localMatches };
        renderBracket(matches, faseActiva);
        render();
        renderParticipantes();
    });
}

function render() {
    const partidosOctavos = octavos();
    const elegidos = seleccionesOrdenadas();
    const cerrado = seleccionesCerradas();
    const puedeSeleccionar = Boolean(currentUser) && !cerrado;
    const limiteAlcanzado = elegidos.length >= LIMITE_EQUIPOS;

    availableCount.textContent = `${elegidos.length}/${LIMITE_EQUIPOS}`;
    selectedCount.textContent = `${elegidos.length}/${LIMITE_EQUIPOS}`;
    btnSave.disabled = !puedeSeleccionar || elegidos.length !== LIMITE_EQUIPOS;
    btnSave.textContent = cerrado ? "Selección cerrada" : "Guardar selección";

    availableTeams.innerHTML = partidosOctavos.map(match => {
        const [equipo1, equipo2] = equiposDelPartido(match);
        const elegido = seleccion[match.id];

        return `
            <article class="pick-card ${elegido ? "is-picked" : ""}" data-match="${escapeHtml(match.id)}">
                <div class="pick-head">
                    <strong>${escapeHtml(match.id)}</strong>
                    <span>${formatFecha(match.kickoff)}</span>
                </div>
                <div class="pick-options">
                    <button class="pick-option ${elegido === equipo1 ? "selected" : ""}" type="button" data-team="${escapeHtml(equipo1)}" ${puedeSeleccionar && (elegido || !limiteAlcanzado) ? "" : "disabled"}>
                        ${teamOptionHtml(equipo1)}
                    </button>
                    <button class="pick-option ${elegido === equipo2 ? "selected" : ""}" type="button" data-team="${escapeHtml(equipo2)}" ${puedeSeleccionar && (elegido || !limiteAlcanzado) ? "" : "disabled"}>
                        ${teamOptionHtml(equipo2)}
                    </button>
                </div>
            </article>
        `;
    }).join("");

    selectedTeams.innerHTML = ordenSeleccion.map((matchId, index) => {
        const nombre = seleccion[matchId];

        return `
            <li class="selected-team ${nombre ? "" : "is-empty"}">
                <span class="position">${index + 1}</span>
                ${nombre ? teamOptionHtml(nombre) : `<span class="pending-pick">${escapeHtml(matchId)} pendiente</span>`}
                <span class="team-actions">
                    <button type="button" data-action="up" data-match="${escapeHtml(matchId)}" ${!puedeSeleccionar || index === 0 ? "disabled" : ""}>↑</button>
                    <button type="button" data-action="down" data-match="${escapeHtml(matchId)}" ${!puedeSeleccionar || index === ordenSeleccion.length - 1 ? "disabled" : ""}>↓</button>
                    <button type="button" data-action="remove" data-match="${escapeHtml(matchId)}" ${!puedeSeleccionar ? "disabled" : ""}>Quitar</button>
                </span>
            </li>
        `;
    }).join("") || `<li class="selected-team is-empty"><span class="pending-pick">Elige el primer ganador.</span></li>`;

    availableTeams.querySelectorAll(".pick-option").forEach(button => {
        button.addEventListener("click", () => {
            if (!currentUser) {
                status.textContent = "Ingresa con Google para seleccionar equipos.";
                return;
            }

            if (seleccionesCerradas()) {
                status.textContent = mensajeCierre();
                return;
            }

            const matchId = button.closest(".pick-card").dataset.match;
            const esPrimeraVez = !seleccion[matchId];

            if (esPrimeraVez && seleccionesOrdenadas().length >= LIMITE_EQUIPOS) {
                status.textContent = `Solo puedes elegir ${LIMITE_EQUIPOS} selecciones. Quita una para elegir otra.`;
                return;
            }

            seleccion[matchId] = button.dataset.team;

            if (esPrimeraVez && !ordenSeleccion.includes(matchId)) {
                ordenSeleccion.push(matchId);
            }

            status.textContent = "";
            render();
        });
    });

    selectedTeams.querySelectorAll("[data-action]").forEach(button => {
        button.addEventListener("click", () => {
            if (!currentUser) {
                status.textContent = "Ingresa con Google para ordenar tu selección.";
                return;
            }

            if (seleccionesCerradas()) {
                status.textContent = mensajeCierre();
                return;
            }

            manejarOrdenSeleccion(button.dataset.match, button.dataset.action);
        });
    });
}

function manejarOrdenSeleccion(matchId, action) {
    const index = ordenSeleccion.indexOf(matchId);

    if (index < 0) return;

    if (action === "remove") {
        delete seleccion[matchId];
        ordenSeleccion.splice(index, 1);
        render();
        return;
    }

    if (action === "up" && index > 0) {
        [ordenSeleccion[index - 1], ordenSeleccion[index]] = [ordenSeleccion[index], ordenSeleccion[index - 1]];
    }

    if (action === "down" && index < ordenSeleccion.length - 1) {
        [ordenSeleccion[index], ordenSeleccion[index + 1]] = [ordenSeleccion[index + 1], ordenSeleccion[index]];
    }

    render();
}

async function guardarSeleccion() {
    if (!currentUser) return;

    if (seleccionesCerradas()) {
        status.textContent = mensajeCierre();
        render();
        return;
    }

    const normalizada = normalizarSeleccion(seleccion, ordenSeleccion);
    const equipos = normalizada.orden.map(matchId => normalizada.picks[matchId]);

    if (equipos.length !== LIMITE_EQUIPOS) {
        status.textContent = `Debes elegir exactamente ${LIMITE_EQUIPOS} selecciones.`;
        aplicarSeleccion(normalizada.picks, normalizada.orden, false);
        render();
        return;
    }

    aplicarSeleccion(normalizada.picks, normalizada.orden, false);
    btnSave.disabled = true;
    btnSave.textContent = "Guardando...";

    try {
        await setDoc(doc(db, "seleccionesOctavos", currentUser.uid), {
            ...datosPerfilUsuario(currentUser),
            equipos,
            picks: normalizada.picks,
            orden: normalizada.orden,
            updatedAt: serverTimestamp()
        });

        status.textContent = "Selección guardada.";
    } catch (e) {
        console.error(e);
        restaurarSeleccionGuardada();
        status.textContent = e.code === "permission-denied"
            ? "No tienes permisos para guardar esta selección. Revisa las reglas de Firestore."
            : e.message;
        render();
    } finally {
        btnSave.textContent = "Guardar selección";
        render();
    }
}

onAuthStateChanged(auth, async user => {
    currentUser = user;

    if (!user) {
        btnLogin.hidden = false;
        btnLogout.hidden = true;
        selectionPanel.hidden = true;
        userInfo.innerHTML = "";
        status.textContent = "Ingresa con Google para ordenar tus equipos.";
        seleccion = {};
        ordenSeleccion = [];
        seleccionGuardada = {};
        ordenGuardado = [];

        if (unsubscribeSeleccion) {
            unsubscribeSeleccion();
            unsubscribeSeleccion = null;
        }

        render();
        renderParticipantes();
        return;
    }

    btnLogin.hidden = true;
    btnLogout.hidden = false;
    selectionPanel.hidden = false;
    status.textContent = "";

    renderUser(user);
    renderParticipantes();
    iniciarSeleccion(user);
});

iniciarLlave();
iniciarConfig();
iniciarParticipantes();
setInterval(render, 30000);
