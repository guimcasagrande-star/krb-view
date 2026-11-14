"""
Servidor PACS de teste, para experimentar pesquisa e download sem tocar num
PACS de hospital. Serve os arquivos DICOM de uma pasta.

    pip install pynetdicom
    python scripts/pacs-servidor-teste.py test-data/phantom

Depois, em outro terminal (com o servidor "local" do pacs.exemplo.json):

    npm run pacs -- eco local
    npm run pacs -- buscar local --nome phantom

Com conexão segura (DICOM TLS), passe o certificado e a chave nas variáveis de ambiente:

    PACS_TLS_CERT=cert.pem PACS_TLS_KEY=chave.pem python scripts/pacs-servidor-teste.py test-data/phantom
"""

import fnmatch
import os
import ssl
import sys

from pydicom import dcmread
from pydicom.dataset import Dataset
from pydicom.uid import (
    ExplicitVRLittleEndian,
    ImplicitVRLittleEndian,
    JPEG2000Lossless,
    JPEGLosslessSV1,
    RLELossless,
)
from pynetdicom import AE, StoragePresentationContexts, evt
from pynetdicom.sop_class import (
    StudyRootQueryRetrieveInformationModelFind,
    StudyRootQueryRetrieveInformationModelGet,
    Verification,
)

folder = sys.argv[1] if len(sys.argv) > 1 else os.path.join("test-data", "phantom")
port = int(sys.argv[2]) if len(sys.argv) > 2 else 11112
ae_title = sys.argv[3] if len(sys.argv) > 3 else "TESTEPACS"
# AE titles autorizados a conectar (vazio = qualquer um), separados por vírgula.
allowed = [a for a in (sys.argv[4].split(",") if len(sys.argv) > 4 else []) if a]

index = []
for root, _, names in os.walk(folder):
    for name in names:
        path = os.path.join(root, name)
        try:
            ds = dcmread(path, stop_before_pixels=True)
            index.append((path, ds))
        except Exception:
            pass
print(f"{len(index)} arquivos DICOM em {folder}", flush=True)


def text(ds, keyword):
    value = ds.get(keyword, "")
    return "" if value is None else str(value)


def matches(value, pattern):
    if pattern in ("", None):
        return True
    pattern = str(pattern)
    if "-" in pattern and pattern.replace("-", "").isdigit():
        low, high = pattern.split("-", 1)
        return (low == "" or value >= low) and (high == "" or value <= high)
    return fnmatch.fnmatchcase(value.upper(), pattern.upper())


def handle_find(event):
    query = event.identifier
    level = query.QueryRetrieveLevel
    seen = {}
    for _, ds in index:
        if not matches(text(ds, "PatientName"), query.get("PatientName", "")):
            continue
        if not matches(text(ds, "PatientID"), query.get("PatientID", "")):
            continue
        if not matches(text(ds, "StudyDate"), query.get("StudyDate", "")):
            continue
        if not matches(text(ds, "AccessionNumber"), query.get("AccessionNumber", "")):
            continue
        if query.get("StudyInstanceUID") and ds.StudyInstanceUID != query.StudyInstanceUID:
            continue
        key = ds.StudyInstanceUID if level == "STUDY" else ds.SeriesInstanceUID
        seen.setdefault(key, []).append(ds)

    for key, group in seen.items():
        if event.is_cancelled:
            yield 0xFE00, None
            return
        first = group[0]
        reply = Dataset()
        reply.SpecificCharacterSet = "ISO_IR 100"
        reply.QueryRetrieveLevel = level
        reply.StudyInstanceUID = first.StudyInstanceUID
        if level == "STUDY":
            modalities = sorted({d.Modality for d in group})
            wanted = query.get("ModalitiesInStudy", "")
            if wanted and wanted not in modalities:
                continue
            reply.PatientName = first.get("PatientName", "")
            reply.PatientID = first.get("PatientID", "")
            reply.PatientBirthDate = first.get("PatientBirthDate", "")
            reply.PatientSex = first.get("PatientSex", "")
            reply.StudyDate = first.get("StudyDate", "")
            reply.StudyTime = first.get("StudyTime", "")
            reply.AccessionNumber = first.get("AccessionNumber", "")
            reply.StudyDescription = first.get("StudyDescription", "")
            reply.ModalitiesInStudy = modalities
            reply.NumberOfStudyRelatedSeries = len({d.SeriesInstanceUID for d in group})
            reply.NumberOfStudyRelatedInstances = len(group)
        else:
            reply.SeriesInstanceUID = first.SeriesInstanceUID
            reply.SeriesNumber = first.get("SeriesNumber", None)
            reply.Modality = first.Modality
            reply.SeriesDescription = first.get("SeriesDescription", "")
            reply.NumberOfSeriesRelatedInstances = len(group)
        yield 0xFF00, reply


def handle_get(event):
    query = event.identifier
    selected = [
        path
        for path, ds in index
        if ds.StudyInstanceUID == query.get("StudyInstanceUID")
        and (query.QueryRetrieveLevel != "SERIES" or ds.SeriesInstanceUID == query.get("SeriesInstanceUID"))
    ]
    yield len(selected)
    for path in selected:
        if event.is_cancelled:
            yield 0xFE00, None
            return
        yield 0xFF00, dcmread(path)


def handle_requested(event):
    calling = event.assoc.requestor.ae_title.strip()
    print(f"associação de {calling}", flush=True)


if os.environ.get("PACS_DEBUG"):
    from pynetdicom import debug_logger

    debug_logger()

ae = AE(ae_title=ae_title)
ae.require_called_aet = True
if allowed:
    ae.require_calling_aet = allowed
ae.maximum_pdu_size = 16382
ae.add_supported_context(Verification)
ae.add_supported_context(StudyRootQueryRetrieveInformationModelFind)
ae.add_supported_context(StudyRootQueryRetrieveInformationModelGet)
syntaxes = [ExplicitVRLittleEndian, ImplicitVRLittleEndian, RLELossless, JPEGLosslessSV1, JPEG2000Lossless]
for context in StoragePresentationContexts:
    # Papéis do ponto de vista de quem pede: aceitamos que o cliente seja o SCP de armazenamento.
    ae.add_supported_context(context.abstract_syntax, syntaxes, scu_role=False, scp_role=True)

ssl_context = None
if os.environ.get("PACS_TLS_CERT"):
    ssl_context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    ssl_context.minimum_version = ssl.TLSVersion.TLSv1_2
    ssl_context.load_cert_chain(os.environ["PACS_TLS_CERT"], os.environ.get("PACS_TLS_KEY"))

print(f"servidor de teste {ae_title} na porta {port}" + (" (TLS)" if ssl_context else ""), flush=True)
ae.start_server(
    ("127.0.0.1", port),
    ssl_context=ssl_context,
    evt_handlers=[
        (evt.EVT_C_FIND, handle_find),
        (evt.EVT_C_GET, handle_get),
        (evt.EVT_REQUESTED, handle_requested),
    ],
)
