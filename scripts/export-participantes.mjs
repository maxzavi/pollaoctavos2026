const PROJECT_ID = "pollaromeros";
const COLLECTION = "seleccionesOctavos";
const DEFAULT_OUTPUT = "participantes.csv";
const MAX_OPTIONS = 4;
const MATCH_ORDER = ["O1", "O2", "O3", "O4", "O5", "O6", "O7", "O8"];

const args = process.argv.slice(2);
const outputArgIndex = args.findIndex(arg => arg === "--output" || arg === "-o");
const outputPath = outputArgIndex >= 0
    ? args[outputArgIndex + 1]
    : DEFAULT_OUTPUT;

function firestoreValue(value) {
    if (!value) return null;
    if ("stringValue" in value) return value.stringValue;
    if ("integerValue" in value) return Number(value.integerValue);
    if ("doubleValue" in value) return Number(value.doubleValue);
    if ("booleanValue" in value) return value.booleanValue;
    if ("timestampValue" in value) return value.timestampValue;
    if ("nullValue" in value) return null;
    if ("arrayValue" in value) {
        return (value.arrayValue.values || []).map(firestoreValue);
    }
    if ("mapValue" in value) {
        return Object.fromEntries(
            Object.entries(value.mapValue.fields || {})
                .map(([key, item]) => [key, firestoreValue(item)])
        );
    }

    return null;
}

function documentData(document) {
    return Object.fromEntries(
        Object.entries(document.fields || {})
            .map(([key, value]) => [key, firestoreValue(value)])
    );
}

function orderedOptions(data) {
    const picks = data.picks || {};
    const orderedMatchIds = [];

    function addMatch(matchId) {
        if (!picks[matchId] || orderedMatchIds.includes(matchId)) {
            return;
        }

        orderedMatchIds.push(matchId);
    }

    if (Array.isArray(data.orden) && data.orden.length > 0) {
        data.orden.forEach(addMatch);
    }

    MATCH_ORDER.forEach(addMatch);
    Object.keys(picks).sort().forEach(addMatch);

    const orderedPicks = orderedMatchIds
        .map(matchId => picks[matchId])
        .filter(Boolean);

    if (orderedPicks.length > 0) {
        return orderedPicks.slice(0, MAX_OPTIONS);
    }

    return Array.isArray(data.equipos)
        ? data.equipos.filter(Boolean).slice(0, MAX_OPTIONS)
        : [];
}

function csvCell(value) {
    const text = String(value ?? "");

    if (/[",\n\r]/.test(text)) {
        return `"${text.replaceAll('"', '""')}"`;
    }

    return text;
}

function toCsv(rows) {
    const headers = [
        "uid",
        "nombre",
        "email",
        ...Array.from({ length: MAX_OPTIONS }, (_, index) => `opcion_${index + 1}`),
        "updatedAt"
    ];

    return [
        headers.join(","),
        ...rows.map(row => headers.map(header => {
            if (header.startsWith("opcion_")) {
                const index = Number(header.replace("opcion_", "")) - 1;
                return csvCell(row.opciones[index] || "");
            }

            return csvCell(row[header]);
        }).join(","))
    ].join("\n");
}

async function fetchAllDocuments() {
    const documents = [];
    let pageToken = "";

    do {
        const url = new URL(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${COLLECTION}`);
        url.searchParams.set("pageSize", "100");

        if (pageToken) {
            url.searchParams.set("pageToken", pageToken);
        }

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Firestore respondio ${response.status}: ${await response.text()}`);
        }

        const payload = await response.json();
        documents.push(...(payload.documents || []));
        pageToken = payload.nextPageToken || "";
    } while (pageToken);

    return documents;
}

async function main() {
    if (!outputPath) {
        throw new Error("Debes indicar una ruta luego de --output.");
    }

    const documents = await fetchAllDocuments();
    const rows = documents
        .map(document => {
            const data = documentData(document);
            const uid = data.uid || document.name.split("/").pop();

            return {
                uid,
                nombre: data.nombre || data.email || "Participante",
                email: data.email || "",
                opciones: orderedOptions(data),
                updatedAt: data.updatedAt || ""
            };
        })
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    const { writeFile } = await import("node:fs/promises");
    await writeFile(outputPath, `${toCsv(rows)}\n`, "utf8");
    console.log(`Archivo generado: ${outputPath}`);
    console.log(`Participantes exportados: ${rows.length}`);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
