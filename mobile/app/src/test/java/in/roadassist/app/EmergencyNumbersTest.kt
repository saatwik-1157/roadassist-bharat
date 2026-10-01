package `in`.roadassist.app

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The one list of India's emergency numbers. 112 leads, every number is
 * dialable digits, and the ids the web side matches on are unique.
 */
class EmergencyNumbersTest {

    private val all = EmergencyNumbers.ALL

    @Test
    fun `the list starts with 112 and it is the only primary`() {
        assertEquals("112", all.first().number)
        assertTrue(all.first().primary)
        assertEquals(listOf("112"), all.filter { it.primary }.map { it.number })
    }

    @Test
    fun `the SOS ladder's dialer rung dials the primary number`() {
        assertEquals(Emergency.NATIONAL_EMERGENCY, all.first { it.primary }.number)
    }

    @Test
    fun `numbers are digits only`() {
        all.forEach { assertTrue("'${it.number}' is not digits only", it.number.matches(Regex("[0-9]+"))) }
    }

    @Test
    fun `ids and numbers are unique`() {
        assertEquals(all.size, all.map { it.id }.toSet().size)
        assertEquals(all.size, all.map { it.number }.toSet().size)
        assertEquals(all.size, all.map { it.labelRes }.toSet().size)
    }

    @Test
    fun `the list is the agreed six in the agreed order`() {
        assertEquals(
            listOf("112" to "all", "1033" to "highway", "108" to "ambulance",
                "102" to "ambulance_alt", "100" to "police", "101" to "fire"),
            all.map { it.number to it.id },
        )
    }

    /** The web side parses this file line by line; keep one entry per line, number then id. */
    @Test
    fun `the source keeps one parseable entry per line`() {
        val src = listOf(
            File("src/main/java/in/roadassist/app/EmergencyNumbers.kt"),
            File("app/src/main/java/in/roadassist/app/EmergencyNumbers.kt"),
        ).first { it.isFile }.readText()
        val parsed = Regex("""^\s*EmergencyNumber\("(\d+)", "([a-z_]+)"""", RegexOption.MULTILINE)
            .findAll(src).map { it.groupValues[1] to it.groupValues[2] }.toList()
        assertEquals(all.map { it.number to it.id }, parsed)
    }
}
