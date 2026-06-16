package com.gameplan.daemon

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

@RunWith(RobolectricTestRunner::class)
class UnifiedDaemonContractTest {

    @Test
    fun opHandlerRejectsUnknownOpType() {
        val context = ApplicationProvider.getApplicationContext<Context>()

        val result = OpHandler.handle(context, JSONObject().put("type", "not_a_real_op"))

        assertFalse(result.ok)
        assertEquals("Unknown op type: not_a_real_op", result.error)
    }

    @Test
    fun androidFileOpsRejectAppPrivateDataPaths() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val appDataDir = File(context.applicationInfo.dataDir ?: context.filesDir.path)
        val privateFile = File(appDataDir, "shared_prefs/jarvis_daemon.xml").path
        val privateDir = File(appDataDir, "shared_prefs").path
        val operations = listOf(
            JSONObject().put("type", "android_file_list").put("path", privateDir),
            JSONObject().put("type", "android_file_read").put("path", privateFile),
            JSONObject().put("type", "android_file_search").put("query", "jarvis").put("root", appDataDir.path),
            JSONObject().put("type", "android_open_file").put("path", privateFile),
            JSONObject().put("type", "android_copy_to_clipboard").put("path", privateFile),
        )

        for (op in operations) {
            val result = OpHandler.handle(context, op)

            assertFalse("${op.getString("type")} should reject private app paths", result.ok)
            assertTrue(
                "${op.getString("type")} returned unexpected error: ${result.error}",
                result.error?.contains("App-private file paths") == true
            )
        }
    }

    @Test
    fun androidReturnToJarvisPrefersUnifiedApp() {
        val context = ApplicationProvider.getApplicationContext<Context>()

        val result = OpHandler.handle(context, JSONObject().put("type", "android_return_to_jarvis"))
        val data = result.data as JSONObject

        assertTrue(result.ok)
        assertEquals("app", data.getString("target"))
        assertEquals(context.packageName, data.getString("pkg"))
    }

    @Test
    fun normalizeServerUrlAddsHttpsForBareHost() {
        assertEquals(
            "https://gameplanjarvisai.up.railway.app",
            JarvisConfig.normalizeServerUrl("gameplanjarvisai.up.railway.app")
        )
    }

    @Test
    fun reconnectStateKeysStayCompatibleWithStandaloneDaemon() {
        assertEquals("daemon_id", WebSocketService.EXTRA_DAEMON_ID)
        assertEquals("reconnect_secret", WebSocketService.EXTRA_RECONNECT_SECRET)
        assertEquals("daemon_id", WebSocketService.PREF_DAEMON_ID)
        assertEquals("reconnect_secret", WebSocketService.PREF_RECONNECT_SECRET)
    }

    @Test
    fun localGemmaModelPathStoresUnderSafeModelDirectoryWhenManagerExists() {
        val managerClass = runCatching {
            Class.forName("com.gameplan.daemon.LocalGemmaModelManager")
        }.getOrNull() ?: return
        val context = ApplicationProvider.getApplicationContext<Context>()
        val modelId = "google/gemma 4:e2b-it"
        val method = managerClass.methods.firstOrNull { candidate ->
            candidate.returnType == File::class.java &&
                candidate.parameterTypes.toList() == listOf(Context::class.java, String::class.java)
        }

        assertTrue("LocalGemmaModelManager exposes a Context/String File path helper", method != null)

        val modelFile = method!!.invoke(null, context, modelId) as File
        val expectedSuffix = File(File(File(context.filesDir, "local_models"), "google_gemma_4_e2b-it"), "model.bin").path
        assertTrue(
            "Expected model file to end with $expectedSuffix, got ${modelFile.path}",
            modelFile.path.endsWith(expectedSuffix)
        )
    }
}
