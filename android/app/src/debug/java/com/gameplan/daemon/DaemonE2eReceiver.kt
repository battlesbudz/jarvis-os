package com.gameplan.daemon

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat

class DaemonE2eReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_E2E_BOOTSTRAP -> bootstrapDaemon(context, intent)
            ACTION_E2E_VOICE_SESSION -> handleVoiceSessionCommand(context, intent)
        }
    }

    private fun bootstrapDaemon(context: Context, intent: Intent) {
        val serviceIntent = Intent(context, WebSocketService::class.java).apply {
            action = WebSocketService.ACTION_BOOTSTRAP
            putExtra(
                WebSocketService.EXTRA_SERVER_URL,
                intent.getStringExtra(WebSocketService.EXTRA_SERVER_URL) ?: "",
            )
            putExtra(
                WebSocketService.EXTRA_BOOTSTRAP_TOKEN,
                intent.getStringExtra(WebSocketService.EXTRA_BOOTSTRAP_TOKEN) ?: "",
            )
        }
        ContextCompat.startForegroundService(context, serviceIntent)
    }

    private fun handleVoiceSessionCommand(context: Context, intent: Intent) {
        val command = intent.getStringExtra(EXTRA_COMMAND)
        val token = intent.getStringExtra(EXTRA_TOKEN) ?: "none"
        Log.i(TAG, "received command=$command token=$token")
        try {
            when (command) {
                "start" -> startVoiceService(context, OutsideAppVoiceSessionService.startIntent(context))
                "pause" -> startVoiceService(
                    context,
                    OutsideAppVoiceSessionService.controlIntent(context, OutsideAppVoiceSessionService.ACTION_PAUSE),
                )
                "resume" -> startVoiceService(
                    context,
                    OutsideAppVoiceSessionService.controlIntent(context, OutsideAppVoiceSessionService.ACTION_RESUME),
                )
                "end" -> context.startService(
                    OutsideAppVoiceSessionService.controlIntent(context, OutsideAppVoiceSessionService.ACTION_END),
                )
                "set_state" -> {
                    val state = OutsideAppVoiceState.fromWireName(intent.getStringExtra(OutsideAppVoiceSessionService.EXTRA_STATE))
                    startVoiceService(context, OutsideAppVoiceSessionService.setStateIntent(context, state))
                }
                "set_approval" -> startVoiceService(
                    context,
                    OutsideAppVoiceSessionService.setApprovalIntent(
                        context,
                        intent.getStringExtra(OutsideAppVoiceSessionService.EXTRA_APPROVAL_PROMPT)
                            ?: "Approve this action?",
                        intent.getStringExtra(OutsideAppVoiceSessionService.EXTRA_APPROVAL_TOKEN),
                    ),
                )
                "approve" -> OutsideAppVoiceSessionService.instance?.onOverlayApprove()
                "deny" -> OutsideAppVoiceSessionService.instance?.onOverlayDeny()
                "overlay_tap" -> OutsideAppVoiceSessionService.instance?.onOverlayTapped()
                "crash" -> {
                    startVoiceService(context, OutsideAppVoiceSessionService.e2eCrashIntent(context))
                    Log.i(TAG, "token=$token e2eCrashCommand=dispatched")
                }
                "status" -> Unit
                else -> Log.w(TAG, "unknown command=$command token=$token")
            }
        } catch (throwable: Throwable) {
            Log.e(TAG, "command failed command=$command token=$token", throwable)
        } finally {
            logVoiceSessionStatus(token)
        }
    }

    private fun startVoiceService(context: Context, intent: Intent) {
        ContextCompat.startForegroundService(context, intent)
    }

    private fun logVoiceSessionStatus(token: String) {
        val active = OutsideAppVoiceSessionService.isActive()
        val state = OutsideAppVoiceSessionService.currentState()
        val approvalPrompt = OutsideAppVoiceSessionService.currentApprovalPrompt()
        val overlayTapAction = OutsideAppVoiceSessionStateMachine.overlayTapAction(state)
        val notificationActions = OutsideAppVoiceSessionStateMachine.notificationActions()
            .joinToString(",") { it.label }
        Log.i(
            TAG,
            "token=$token active=$active state=${state.wireName} approvalPrompt=\"$approvalPrompt\" overlayTap=$overlayTapAction actions=$notificationActions",
        )
    }

    companion object {
        private const val TAG = "JarvisVoiceE2E"
        const val ACTION_E2E_BOOTSTRAP = "com.gameplan.daemon.E2E_BOOTSTRAP"
        const val ACTION_E2E_VOICE_SESSION = "com.gameplan.daemon.E2E_VOICE_SESSION"
        const val EXTRA_COMMAND = "command"
        const val EXTRA_TOKEN = "token"
    }
}
