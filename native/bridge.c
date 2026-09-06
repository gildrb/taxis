#include "korsvg.h"
#include "archetypon.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Single-owner Taxis ABI. All rendering and encoding stay in the retained C libraries. */
struct taxis_document {
    KorSVGDocumentRef document;
    KorSVGContextRef context;
    KorSVGDataRef serialized;
    struct archetypon_buffer png;
};
static _Thread_local char bridge_error[256];

struct taxis_document *taxis_parse(const uint8_t *source, size_t length) {
    bridge_error[0] = 0;
    if (!source || !length || length > 32u * 1024u * 1024u) {
        snprintf(bridge_error, sizeof bridge_error, "SVG source must contain 1 to 33,554,432 bytes");
        return NULL;
    }
    KorSVGDataRef data = KorSVGDataCreate(source, length);
    KorSVGDocumentRef document = data ? KorSVGDocumentCreateFromData(data, NULL) : NULL;
    if (!document) snprintf(bridge_error, sizeof bridge_error, "%s", KorSVGGetLastError());
    KorSVGDataRelease(data);
    if (!document) return NULL;
    struct taxis_document *handle = calloc(1, sizeof *handle);
    if (!handle) {
        KorSVGDocumentRelease(document);
        snprintf(bridge_error, sizeof bridge_error, "out of memory creating bridge handle");
        return NULL;
    }
    handle->document = document;
    KorSVGDocumentSetPlanCacheLimit(document, 8u * 1024u * 1024u);
    return handle;
}

int taxis_size(struct taxis_document *handle, double dimensions[2]) {
    bridge_error[0] = 0;
    if (!handle || !dimensions) {
        snprintf(bridge_error, sizeof bridge_error, "document and dimensions are required");
        return 0;
    }
    KorSVGSize size = KorSVGDocumentGetCanvasSize(handle->document);
    dimensions[0] = size.width;
    dimensions[1] = size.height;
    return 1;
}

const uint8_t *taxis_render_rgba(struct taxis_document *handle, int32_t width,
                               int32_t height, size_t *stride) {
    bridge_error[0] = 0;
    if (!handle || !stride) {
        snprintf(bridge_error, sizeof bridge_error, "document and stride are required");
        return NULL;
    }
    *stride = 0;
    KorSVGContextRef context = KorSVGContextCreate(width, height);
    if (!context || !KorSVGContextClear(context, 0, 0, 0, 0) ||
        !KorSVGContextDrawDocument(context, handle->document)) {
        snprintf(bridge_error, sizeof bridge_error, "%s", KorSVGGetLastError());
        KorSVGContextRelease(context);
        return NULL;
    }
    KorSVGContextRelease(handle->context);
    handle->context = context;
    archetypon_buffer_free(&handle->png);
    *stride = KorSVGContextGetStride(context);
    return KorSVGContextGetData(context);
}

const uint8_t *taxis_serialize(struct taxis_document *handle, size_t *length) {
    bridge_error[0] = 0;
    if (!handle || !length) {
        snprintf(bridge_error, sizeof bridge_error, "document and length are required");
        return NULL;
    }
    *length = 0;
    if (!handle->serialized) {
        KorSVGDataRef data = KorSVGDataCreateMutable();
        if (!data || !KorSVGDocumentWriteToData(handle->document, data, NULL)) {
            snprintf(bridge_error, sizeof bridge_error, "%s", KorSVGGetLastError());
            KorSVGDataRelease(data);
            return NULL;
        }
        handle->serialized = data;
    }
    *length = KorSVGDataGetLength(handle->serialized);
    return KorSVGDataGetBytes(handle->serialized);
}

const uint8_t *taxis_png(struct taxis_document *handle, size_t *length) {
    bridge_error[0] = 0;
    if (!handle || !handle->context || !length) {
        snprintf(bridge_error, sizeof bridge_error, "render a document before PNG encoding");
        return NULL;
    }
    *length = 0;
    struct archetypon_image image = {
        .width = KorSVGContextGetWidth(handle->context),
        .height = KorSVGContextGetHeight(handle->context),
        .pixels = KorSVGContextGetData(handle->context)
    };
    if (KorSVGContextGetStride(handle->context) != (size_t)image.width * 4) {
        snprintf(bridge_error, sizeof bridge_error, "PNG requires packed RGBA rows");
        return NULL;
    }
    if (!handle->png.data && archetypon_png_encode(&image, &handle->png,
            bridge_error, sizeof bridge_error) != 0) return NULL;
    /* image borrows context pixels: do not call archetypon_image_free(&image). */
    *length = handle->png.length;
    return handle->png.data;
}

const char *taxis_error(void) { return bridge_error; }

void taxis_free(struct taxis_document *handle) {
    if (!handle) return;
    KorSVGDataRelease(handle->serialized);
    archetypon_buffer_free(&handle->png);
    KorSVGContextRelease(handle->context);
    KorSVGDocumentRelease(handle->document);
    free(handle);
}
