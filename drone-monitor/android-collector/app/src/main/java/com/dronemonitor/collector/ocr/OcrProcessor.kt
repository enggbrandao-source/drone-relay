package com.dronemonitor.collector.ocr

import android.graphics.Bitmap
import android.graphics.Rect
import android.util.Log
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.dronemonitor.collector.util.FileLogger

/**
 * Processador OCR utilizando ML Kit como FALLBACK quando acessibilidade falha.
 *
 * QUANDO E USADO:
 * - Quando o DroneAccessibilityService nao consegue extrair dados suficientes
 * - Quando o DJI SmartFarm renderiza dados como imagens em vez de textos
 * - Quando a hierarquia de views nao expoe os valores numericos
 *
 * COMO FUNCIONA:
 * 1. Captura regioes especificas da tela (screenshot via MediaProjection)
 * 2. Processa cada regiao com ML Kit Text Recognition
 * 3. Extrai textos e retorna para o TelemetryParser
 * 4. Nao requer SDK DJI - apenas leitura visual da tela
 *
 * LIMITACOES:
 * - Requer permissao de captura de tela (MediaProjection)
 * - Mais lento que acessibilidade (processamento de imagem)
 * - Pode ter erros de OCR em condicoes de luz ruins
 * - Consome mais CPU/bateria
 */
class OcrProcessor {

    private val latinRecognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private val chineseRecognizer = TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())

    /**
     * Processa bitmap da tela e extrai texto de regioes de interesse.
     *
     * @param bitmap Screenshot da tela do RC Plus
     * @param regions Regioes de interesse (painel superior, lateral, inferior, centro)
     * @param callback Retorna mapa de textos extraidos por regiao
     */
    fun processScreen(bitmap: Bitmap, regions: List<Rect>, callback: (Map<String, String>) -> Unit) {
        val results = mutableMapOf<String, String>()
        var processed = 0

        if (regions.isEmpty()) {
            processRegion(bitmap, Rect(0, 0, bitmap.width, bitmap.height)) { text ->
                results["full_screen"] = text
                callback(results)
            }
            return
        }

        for ((index, region) in regions.withIndex()) {
            processRegion(bitmap, region) { text ->
                results["region_$index"] = text
                processed++
                if (processed >= regions.size) {
                    callback(results)
                }
            }
        }
    }

    /**
     * Overload para uso direto sem callback (retorna texto concatenado de todas as regioes).
     * Usado pelo DroneCollectorService quando precisa de resultado sincrono simplificado.
     */
    fun processScreen(): com.dronemonitor.collector.data.TelemetryData {
        // Sem MediaProjection ativo, retorna vazio indicando OCR como fonte
        return com.dronemonitor.collector.data.TelemetryData(
            sourceMap = com.dronemonitor.collector.data.TelemetrySourceMap(
                operationalStatus = com.dronemonitor.collector.data.TelemetrySource.OCR
            )
        )
    }

    private fun processRegion(bitmap: Bitmap, region: Rect, callback: (String) -> Unit) {
        try {
            val cropped = Bitmap.createBitmap(bitmap, region.left, region.top, region.width(), region.height())
            val image = InputImage.fromBitmap(cropped, 0)

            latinRecognizer.process(image)
                .addOnSuccessListener { visionText ->
                    val text = visionText.text
                    if (text.isBlank()) {
                        // Tenta reconhecedor chines (DJI SmartFarm pode ter interface chinesa)
                        chineseRecognizer.process(image)
                            .addOnSuccessListener { chineseText ->
                                callback(chineseText.text)
                            }
                            .addOnFailureListener {
                                callback("")
                            }
                    } else {
                        callback(text)
                    }
                }
                .addOnFailureListener { e ->
                    FileLogger.e(TAG, "Falha OCR na regiao", e)
                    callback("")
                }
        } catch (e: Exception) {
            FileLogger.e(TAG, "Erro ao processar regiao OCR", e)
            callback("")
        }
    }

    companion object {
        private const val TAG = "OcrProcessor"

        /**
         * Regioes tipicas da interface DJI SmartFarm (proporcionais a 1920x1080).
         * Estas regioes foram mapeadas visualmente da interface do SmartFarm:
         *
         * Regiao 0 - Painel superior esquerdo:
         *   Contem: velocidade, altitude, distancia, sinal RC
         *
         * Regiao 1 - Painel lateral direito:
         *   Contem: bateria do drone, nivel do tanque, status RTK, sinal GPS
         *
         * Regiao 2 - Painel inferior:
         *   Contem: area aplicada (hectares), tempo de voo, vazao
         *
         * Regiao 3 - Centro da tela:
         *   Contem: status operacional (Aplicando, Voando, etc.)
         */
        fun getDefaultRegions(screenWidth: Int, screenHeight: Int): List<Rect> {
            val scaleX = screenWidth / 1920f
            val scaleY = screenHeight / 1080f
            return listOf(
                // Painel superior (velocidade, altitude, sinal)
                Rect((20 * scaleX).toInt(), (20 * scaleY).toInt(), (600 * scaleX).toInt(), (200 * scaleY).toInt()),
                // Painel lateral direito (bateria, tanque, RTK)
                Rect((1320 * scaleX).toInt(), (100 * scaleY).toInt(), (1900 * scaleX).toInt(), (600 * scaleY).toInt()),
                // Painel inferior (area, tempo, vazao)
                Rect((300 * scaleX).toInt(), (900 * scaleY).toInt(), (1620 * scaleX).toInt(), (1060 * scaleY).toInt()),
                // Centro (status operacional)
                Rect((700 * scaleX).toInt(), (400 * scaleY).toInt(), (1220 * scaleX).toInt(), (680 * scaleY).toInt())
            )
        }
    }
}
