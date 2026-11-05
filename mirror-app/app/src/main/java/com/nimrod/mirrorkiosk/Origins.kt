package com.nimrod.mirrorkiosk

import java.net.URI

/** Pure Kotlin (no Android), so it is tested on its own in src/test. */
object Origins {
    /** "http://host:port" (lower case, the scheme's usual port filled in), or null for anything that is not http(s) or does not parse. */
    fun of(url: String): String? = try {
        val u = URI(url)
        val scheme = u.scheme?.lowercase()
        val host = u.host?.lowercase()
        if ((scheme == "http" || scheme == "https") && !host.isNullOrEmpty()) {
            val port = if (u.port != -1) u.port else if (scheme == "https") 443 else 80
            "$scheme://$host:$port"
        } else null
    } catch (e: Exception) { null }

    /** Same scheme, host and port. Two addresses that do not parse are never the same. */
    fun same(a: String, b: String): Boolean {
        val oa = of(a) ?: return false
        return oa == of(b)
    }
}
