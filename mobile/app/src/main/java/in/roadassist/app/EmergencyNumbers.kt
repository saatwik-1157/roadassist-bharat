package `in`.roadassist.app

/**
 * India's emergency numbers, one list for the whole app. Mirrors
 * app/apps/web/emergency-numbers.js; a unit test on the web side fails the build if the two drift.
 * Sources (checked 2026-10-01):
 *  - 112: Ministry of Home Affairs, Emergency Response Support System (ERSS), https://112.gov.in
 *    The single number that integrates 100 (police), 101 (fire) and 102/108 (ambulance).
 *  - 1033: NHAI national-highway helpline, 24x7, toll-free (IHMCL, https://ihmcl.co.in/?p=3491):
 *    ambulance, patrol vehicle and crane on NHAI stretches.
 *  - 102 / 108: state-run ambulance services; which one answers varies by state.
 * Other national helplines (checked 2026-10-05), shown after the six above under their own subheading:
 *  - 181: Women Helpline, Ministry of Women & Child Development (MWCD), 24x7.
 *  - 1098: Childline, for children in distress, 24x7.
 *  - 14567: Elderline, Ministry of Social Justice & Empowerment (MoSJE), for senior citizens;
 *    operates 8 AM–8 PM all days.
 */
data class EmergencyNumber(val number: String, val id: String, val labelRes: Int, val primary: Boolean = false)

object EmergencyNumbers {
    val ALL = listOf(
        EmergencyNumber("112", "all", R.string.emergency_112, primary = true),
        EmergencyNumber("1033", "highway", R.string.emergency_1033),
        EmergencyNumber("108", "ambulance", R.string.emergency_108),
        EmergencyNumber("102", "ambulance_alt", R.string.emergency_102),
        EmergencyNumber("100", "police", R.string.emergency_100),
        EmergencyNumber("101", "fire", R.string.emergency_101),
        EmergencyNumber("181", "women", R.string.emergency_181),
        EmergencyNumber("1098", "child", R.string.emergency_1098),
        EmergencyNumber("14567", "elder", R.string.emergency_14567),
    )

    /**
     * The entries shown under "Other national helplines", after the emergency numbers. They are the
     * tail of [ALL], so display order is still [ALL]'s; emergency-numbers.js keeps the same set.
     */
    val HELPLINE_IDS = setOf("women", "child", "elder")
}
