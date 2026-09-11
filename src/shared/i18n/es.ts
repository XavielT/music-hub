import { TranslationKey } from './en';

/**
 * Spanish dictionary.
 *
 * Typed as a complete record of `TranslationKey`, so the build fails if a key is
 * added to `en.ts` and forgotten here. Written in informal "tú" throughout —
 * this is a family's music app, not a bank — and it keeps the words Spanish
 * speakers actually use for music: "playlist", not "lista de reproducción"
 * everywhere; "biblioteca" for the library.
 */
export const ES: Record<TranslationKey, string> = {
  // --- shared words -------------------------------------------------------
  'common.back': 'Atrás',
  'common.cancel': 'Cancelar',
  'common.save': 'Guardar',
  'common.saving': 'Guardando…',
  'common.saved': 'Guardado',
  'common.delete': 'Eliminar',
  'common.create': 'Crear',
  'common.remove': 'Quitar',
  'common.more': 'Más',
  'common.open': 'Abrir',
  'common.confirm': 'Confirmar',
  'common.off': 'Desactivar',
  'common.shuffle': 'Aleatorio',
  'common.playAll': 'Reproducir todo',
  'common.play': 'Reproducir',
  'common.loading': 'Cargando…',
  'common.song': '{count} canción',
  'common.songs': '{count} canciones',

  // --- bottom navigation --------------------------------------------------
  'nav.home': 'Inicio',
  'nav.search': 'Buscar',
  'nav.library': 'Biblioteca',
  'nav.add': 'Añadir',
  'nav.settings': 'Ajustes',

  // --- sign in / register -------------------------------------------------
  'auth.tagline': 'Tu biblioteca, en todos tus dispositivos.',
  'auth.signIn': 'Iniciar sesión',
  'auth.register': 'Crear cuenta',
  'auth.forgotHint': 'Escribe tu correo y te enviamos un enlace para poner una contraseña nueva.',
  'auth.inviteHint':
    'Music Hub es solo por invitación — crea tu cuenta con un correo que Xaviel ya haya añadido.',
  'auth.email': 'Correo',
  'auth.displayName': 'Nombre',
  'auth.password': 'Contraseña',
  'auth.forgotPassword': '¿Olvidaste tu contraseña?',
  'auth.backToSignIn': 'Volver a iniciar sesión',
  'auth.noAccount': '¿Todavía no tienes cuenta?',
  'auth.haveAccount': '¿Ya tienes cuenta?',
  'auth.sendResetLink': 'Enviar enlace',
  'auth.createAccount': 'Crear cuenta',
  'auth.enterEmail': 'Escribe tu correo.',
  'auth.enterPassword': 'Escribe tu contraseña.',
  'auth.enterDisplayName': 'Escribe un nombre.',
  'auth.working': 'Un momento…',
  'auth.newPassword': 'Contraseña nueva',
  'auth.newPasswordTagline': 'Elige una que sí recuerdes esta vez.',
  'auth.repeatNewPassword': 'Repite la contraseña nueva',
  'auth.savePassword': 'Guardar contraseña',
  'auth.passwordsDiffer': 'Las dos contraseñas no coinciden.',
  'auth.passwordTooShort': 'Usa al menos 6 caracteres.',
  'auth.passwordChanged': 'Contraseña cambiada — entrando…',
  'auth.checkingLink': 'Comprobando el enlace…',

  'auth.err.inviteOnly':
    'Las cuentas son solo por invitación. Pídele a Xaviel que añada tu correo y vuelve a intentarlo.',
  'auth.err.badCredentials': 'Correo o contraseña incorrectos.',
  'auth.err.unconfirmed': 'Confirma tu correo antes de iniciar sesión.',
  'auth.err.alreadyRegistered': 'Ese correo ya tiene cuenta. Prueba a iniciar sesión.',
  'auth.err.weakPassword': 'La contraseña es muy débil — usa al menos 6 caracteres.',
  'auth.err.badEmail': 'Ese correo no parece válido.',
  'auth.err.staleLink':
    'Ese enlace ya no sirve — puede haber caducado o haberse usado antes. Pide uno nuevo desde la pantalla de inicio de sesión.',
  'auth.err.samePassword': 'Elige una contraseña distinta de la que ya tienes.',
  'auth.err.rateLimited': 'Demasiados intentos. Espera un minuto y prueba otra vez.',
  'auth.err.offline': 'Sin conexión con el servidor. Revisa tu internet y prueba otra vez.',
  'auth.err.generic': 'Algo salió mal. Prueba otra vez.',
  'auth.confirmEmail': 'Revisa tu correo para confirmarlo y después inicia sesión.',
  'auth.resetSent': 'Enlace enviado — revisa tu correo (y la carpeta de spam).',
  'auth.accountDisabled':
    'Esta cuenta está desactivada. Habla con Xaviel si crees que es un error.',

  // --- home ---------------------------------------------------------------
  'home.greetingMorning': 'Buenos días',
  'home.greetingAfternoon': 'Buenas tardes',
  'home.greetingEvening': 'Buenas noches',
  'home.emptyTitle': 'Tu biblioteca está vacía',
  'home.emptyText': 'Añade canciones desde tu dispositivo para empezar a escuchar.',
  'home.addMusic': 'Añadir música',
  'home.recentlyAdded': 'Añadido hace poco',
  'home.yourPlaylists': 'Tus playlists',

  // --- search -------------------------------------------------------------
  'search.title': 'Buscar',
  'search.placeholder': 'Canciones, artistas o álbumes…',
  'search.empty': 'No hay resultados en tu biblioteca.',

  // --- library ------------------------------------------------------------
  'library.title': 'Tu biblioteca',
  'library.tab.songs': 'canciones',
  'library.tab.artists': 'artistas',
  'library.tab.albums': 'álbumes',
  'library.tab.playlists': 'playlists',
  'library.tab.wanted': 'deseos',
  'library.empty': 'Todavía no hay canciones. Añade algunas desde la pestaña ＋.',
  'library.nothingHere': 'Aquí todavía no hay nada.',
  'library.newPlaylistName': 'Nombre de la playlist',
  'library.sharedWithYou': 'Compartidas contigo',
  'library.by': 'de {name}',
  'library.sharedWithEveryone': 'Compartida con todos',
  'library.listenerNote':
    'Tu cuenta puede escuchar y descargar todo lo que hay en la biblioteca — pídele a Xaviel que añada música.',

  // --- a song row ---------------------------------------------------------
  'song.needsConnection': 'necesita conexión',
  'song.playNext': 'Reproducir a continuación',
  'song.addToQueue': 'Añadir a la cola',
  'song.editInfo': 'Editar información',
  'song.addToPlaylist': 'Añadir a una playlist',
  'song.badge.uploading': 'Subiendo…',
  'song.badge.downloading': 'Descargando…',
  'song.badge.localOnlyTapUpload': 'Solo en este dispositivo — toca para subirla',
  'song.badge.localOnly': 'Solo en este dispositivo',
  'song.badge.offline': 'En la nube y disponible sin conexión',
  'song.badge.streamsFromLink': 'Suena desde un enlace — necesita conexión',
  'song.badge.cloudTapDownload': 'En la nube — toca para descargarla y oírla sin conexión',

  // --- playlist picker ----------------------------------------------------
  'picker.title': 'Añadir a una playlist',

  // --- song editor --------------------------------------------------------
  'editor.title': 'Editar información',
  'editor.replaceCover': 'Cambiar portada',
  'editor.fieldTitle': 'Título',
  'editor.fieldArtist': 'Artista',
  'editor.fieldAlbum': 'Álbum',
  'editor.localOnlyNote':
    'Este cambio se queda en este dispositivo hasta que pueda llegar a la biblioteca compartida.',

  // --- player -------------------------------------------------------------
  'player.shuffleOn': 'Aleatorio activado',
  'player.shuffleOff': 'Aleatorio desactivado',
  'player.previous': 'Anterior',
  'player.next': 'Siguiente',
  'player.repeatOff': 'Sin repetir',
  'player.repeatAll': 'Repetir todo',
  'player.repeatOne': 'Repetir una',
  'player.volume': 'Volumen',
  'player.speed': 'Velocidad de reproducción',
  'player.sleepTimer': 'Temporizador',
  'player.sleepNote': 'La música se pausa — la cola y el punto exacto se quedan como están.',
  'player.sleepMinutes': '{count} min',
  'player.sleepEndOfSong': 'Al acabar la canción',
  'player.sleepPaused': 'Temporizador — música en pausa.',
  'player.repeatQueue': 'Repetir la cola',
  'player.repeatThisSong': 'Repetir esta canción',
  'player.sleep': 'Dormir',
  'player.sleepHour': '1 hora',
  'player.sleepSeconds': '{count} s',
  'player.queue': 'Cola',
  'player.hideQueue': 'Ocultar cola',
  'player.playingNow': 'Sonando ahora',
  'player.nextUp': 'A continuación',
  'player.playThisNext': 'Reproducir esta ahora',
  'player.moveUp': 'Subir',
  'player.moveDown': 'Bajar',
  'player.lastSong': 'Última canción de la cola.',
  'player.lastSongRepeat': 'Última canción — después la cola vuelve a empezar.',

  // --- playlist details ---------------------------------------------------
  'playlist.sharedBy': 'compartida por {name}',
  'playlist.download': 'Descargar',
  'playlist.offline': 'Sin conexión',
  'playlist.downloadAllTitle': 'Descargar todas las canciones para escucharlas sin conexión',
  'playlist.shuffleTitle': 'Reproducir esta playlist en orden aleatorio',
  'playlist.share': 'Compartir',
  'playlist.shared': 'Compartida',
  'playlist.stopSharing': 'Dejar de compartirla con la casa',
  'playlist.startSharing': 'Deja que todos la vean y añadan canciones',
  'playlist.ownerHint':
    'Todos en casa pueden verla y añadirle canciones. Solo tú puedes renombrarla, dejar de compartirla o eliminarla.',
  'playlist.guestHint':
    'Una playlist compartida — puedes añadir y quitar canciones, y todos ven el cambio.',
  'playlist.empty':
    'Esta playlist está vacía. Añade canciones desde Buscar o Biblioteca con el botón ＋.',
  'playlist.deleteConfirm': '¿Eliminar esta playlist? Las canciones se quedan en tu biblioteca.',

  // --- add music ----------------------------------------------------------
  'add.title': 'Añadir música',
  'add.fromYoutube': 'Desde YouTube',
  'add.ytUnavailable':
    'Buscar en YouTube necesita la app de Android instalada o un companion — un navegador no puede llegar a la API de YouTube directamente. Aun así puedes <strong>pegar un enlace de YouTube</strong> abajo y pedir la canción; alguien la descargará y aparecerá en la biblioteca compartida.',
  'add.downloadsViaCompanion': 'Las descargas pasan por tu companion.',
  'add.noCompanionHere':
    'En este dispositivo no hay companion, así que las canciones se <strong>piden</strong> en vez de descargarse aquí. Un dispositivo que sí lo tenga las descarga, y aparecen en la biblioteca compartida para todos.',
  'add.browseYoutube': 'Abrir YouTube y añadir una canción',
  'add.openingYoutube': 'Abriendo YouTube…',
  'add.browseNote':
    'Abre YouTube aquí mismo. Busca una canción, dale a reproducir y después toca <strong>Añadir esta canción a Music Hub</strong>. No hay nada que configurar.',
  'add.downloadingPercent': 'Descargando — {percent}%',
  'add.ytSearchPlaceholder': 'Busca una canción o pega un enlace de YouTube',
  'add.requestThisSong': 'Pedir esta canción',
  'add.request': 'Pedir',
  'add.requestTitle': 'Pedir a un dispositivo con companion que la descargue',
  'add.downloadHere': 'Descargar en este dispositivo',
  'add.requestedSongs': 'Canciones pedidas',
  'add.removeRequest': 'Quitar esta petición',
  'add.fromThisDevice': 'Desde este dispositivo',
  'add.pickFiles': 'Toca para elegir archivos de audio',
  'add.pickFilesHint':
    'mp3, m4a, mp4, wav, ogg, flac — si los nombras "Artista - Título.mp3" la información se rellena sola',
  'add.readingTags': 'Leyendo las etiquetas de los archivos…',
  'add.albumOptional': 'Álbum (opcional)',
  'add.duplicate': 'Parece un duplicado de <strong>{title}</strong> — puedes añadirla igual.',
  'add.heavyWarning':
    '{count} de estas están por encima de 200 kbps y ocuparían {size} más del 1 GB compartido de lo necesario. Comprimirlas antes con <code>./tools/compress-for-cloud.sh</code> no se nota en un teléfono — o súbelas tal cual, es un aviso y no una barrera.',
  'add.uploadToShared': 'Subirlas a la biblioteca compartida para que suenen en todos los dispositivos',
  'add.staysOnDevice':
    'Estas canciones se quedan en este dispositivo. A la biblioteca compartida añade Xaviel — todo lo que hay en ella ya lo puedes reproducir y descargar.',
  'add.saveCount': 'Guardar {count} canción(es)',
  'add.fromUrl': 'Desde un enlace de audio directo',
  'add.urlPlaceholder': 'https:// enlace directo de audio (.mp3, .m4a…)',
  'add.addSong': 'Añadir canción',
  'add.urlNote':
    'Pega un enlace directo a un archivo de audio y sonará en la app (necesita internet).',
  'add.urlNeedsFields': 'Hacen falta el enlace de audio y el título.',
  'add.savedCount': 'Se añadieron {count} canción(es) a tu biblioteca.',
  'add.status.pending': 'esperando a un dispositivo que pueda descargarla',
  'add.status.working': 'descargando ahora…',
  'add.status.done': 'en la biblioteca ✔',
  'add.status.failed': 'falló',
  'add.queuedAlready': 'Esa canción ya está en la cola.',
  'add.requestSent': 'Canción pedida — aparecerá en la biblioteca en cuanto alguien la descargue.',

  'add.err.searchUnavailable': 'Buscar en YouTube solo funciona en la app de Android instalada o con un companion. Pega un enlace de YouTube y aun así podrás pedir la canción.',
  'add.err.noResults': 'No se encontraron resultados.',
  'add.err.timeout': 'YouTube no respondió a tiempo. Prueba otra vez, o añade la canción desde tu dispositivo aquí abajo.',
  'add.err.searchFailed': 'La búsqueda en YouTube falló. Solo funciona en la app instalada, no en el navegador.',
  'add.err.botProtection': 'YouTube está bloqueando las descargas directas desde la app (protección antibots). Configura el companion en Ajustes, o añade canciones desde tu dispositivo o con un enlace de audio directo.',
  'add.err.couldNotAdd': 'No se pudo añadir esa canción.',
  'add.err.youtubePageLink': 'Ese es un enlace a una página de YouTube, no a un archivo de audio. Las descargas de YouTube están bloqueadas, así que añade la canción como archivo desde tu dispositivo.',
  'add.err.badLink': 'Eso no parece un enlace válido.',
  'add.err.httpsOnly': 'El enlace tiene que ser https:// — los enlaces http normales están bloqueados en la app instalada.',
  'add.addedOne': '"{title}" añadida a tu biblioteca ✔',
  'add.addedToDevice': '{count} canción(es) añadidas a este dispositivo ✔',
  'add.addedAndUploaded': '{count} canción(es) añadidas y subidas a la nube ✔',
  'add.addedPartly': '{count} canción(es) añadidas a este dispositivo — {failed} no se pudieron subir, toca ↑ en tu biblioteca para reintentar.',
  'add.addedFromUrl': 'Canción añadida desde el enlace ✔',

  // --- settings -----------------------------------------------------------
  'settings.title': 'Ajustes',
  'settings.account': 'Cuenta',
  'settings.admin': 'Administración',
  'settings.adminHint': 'Quién puede hacer qué, invitaciones y los ajustes de la biblioteca.',
  'settings.changePassword': 'Cambiar contraseña',
  'settings.changePasswordHint': 'Te enviamos un enlace por correo — aquí no hay que escribir nada.',
  'settings.sendLink': 'Enviar enlace',
  'settings.sending': 'Enviando…',
  'settings.signOut': 'Cerrar sesión',
  'settings.signOutHint':
    'Las canciones descargadas se quedan en este dispositivo para la próxima vez.',
  'settings.language': 'Idioma',
  'settings.languageHint': 'Se aplica al momento y te sigue a tus otros dispositivos.',
  'settings.appearance': 'Apariencia',
  'settings.accentNote': 'El color principal, el que se usa en toda la app.',
  'settings.customColour': 'Color personalizado',
  'settings.backToAmber': 'Volver al ámbar',
  'settings.sharedLibrary': 'Biblioteca compartida',
  'settings.cloudStorage': 'Almacenamiento en la nube',
  'settings.syncNow': 'Sincronizar ahora',
  'settings.nearQuota':
    'Cerca del límite de 1 GB — elimina algunas canciones de la nube antes de añadir más.',
  'settings.onlyOnDevice': '{count} canción(es) solo en este dispositivo',
  'settings.uploadThem': 'Súbelas para que suenen en todas partes.',
  'settings.uploadAll': 'Subir todas',
  'settings.uploading': 'Subiendo…',
  'settings.staysOnDevice':
    '{count} canción(es) se quedan en este dispositivo — a la biblioteca compartida añade Xaviel.',
  'settings.downloadedCount': '{done} de {total} canción(es) están descargadas para escuchar sin conexión.',
  'settings.clearDownloads': 'Borrar descargas',
  'settings.clearDownloadsHint':
    'Libera {size}. Las canciones se quedan en tu biblioteca y suenan por internet hasta que las vuelvas a descargar.',
  'settings.clearing': 'Borrando…',
  'settings.clear': 'Borrar',
  'settings.unclearable':
    '{count} canción(es) están solo en este dispositivo, así que su audio se conserva — borrarlas sería eliminarlas.',
  'settings.whereSpaceGoes': 'En qué se va el espacio',
  'settings.whereSpaceGoesHint': 'Qué está llenando el 1 GB y cuánto devolvería comprimir.',
  'settings.storage': 'Almacenamiento',
  'settings.whoCanJoin': 'Quién puede entrar',
  'settings.youtubeCompanion': 'Companion de YouTube',
  'settings.coverArt': 'Portadas',
  'settings.coverArtNote':
    'Las portadas se leen de las etiquetas de cada archivo. Las canciones que no traen ninguna se pueden buscar en internet.',
  'settings.artworkAllDone': 'Todas las canciones tienen portada, o ya se buscó.',
  'settings.updates': 'Actualizaciones',
  'settings.allowInstalls': 'Permitir que Music Hub instale actualizaciones',
  'settings.allowInstallsHint':
    'Ahora mismo está desactivado, así que las actualizaciones hay que instalarlas a mano.',
  'settings.allow': 'Permitir',
  'settings.canInstall': 'Music Hub puede instalar sus propias actualizaciones.',
  'settings.resetFailed': 'No se pudo enviar el correo.',
  'settings.live.connected': 'En directo — lo que cambies en otro dispositivo aparece aquí solo.',
  'settings.live.connecting': 'Conectando con los cambios en directo…',
  'settings.live.offline': 'Los cambios en directo están desconectados — usa ⟳ hasta que vuelva la conexión.',

  'settings.nothingToClear': 'No hay nada que borrar.',
  'settings.cleared': 'Se borraron {count} descarga(s) — {size} liberados. Seguirán sonando por internet hasta que las vuelvas a descargar.',
  'settings.installsAllowed': 'Music Hub ya puede instalar sus propias actualizaciones.',
  'settings.installsStillOff': 'Sigue desactivado — las actualizaciones habrá que instalarlas a mano.',

  // --- storage page -------------------------------------------------------
  'storage.title': 'Almacenamiento',
  'storage.ofShared': 'de {quota} compartidos',
  'storage.cloudSummary':
    '{count} canciones en la nube, de {average} de media — caben unas <strong>{room}</strong> más de ese tamaño.',
  'storage.nothingYet': 'Todavía no hay nada en la nube.',
  'storage.roomBack': 'Espacio que podrías recuperar',
  'storage.heavySummary':
    '{count} canción(es) están guardadas por encima de 200 kbps. Reconvertirlas a AAC 160k liberaría unos <strong>{size}</strong> — más o menos {songs} canciones más.',
  'storage.reencodeNote':
    'Eso es reconvertir, así que se hace en un ordenador con los originales, no aquí: <code>./tools/compress-for-cloud.sh ~/Music/originals ~/Music/for-cloud</code>, y después reemplázalas desde la pestaña ＋. AAC 160k no se nota en teléfonos ni auriculares.',
  'storage.andMore': '…y {count} más.',
  'storage.nothingToReclaim':
    'Nada que merezca la pena — todas las canciones de la nube ya tienen un bitrate sensato.',
  'storage.onThisDevice': 'En este dispositivo',
  'storage.deviceSummary':
    '{count} canción(es) descargadas, ocupando unos {size}. Una canción descargada se baja una vez en lugar de en cada reproducción, que es lo más barato que puedes hacer con el límite de {egress} de transferencia al mes.',
  'storage.clearingNote':
    'Borrar las descargas está en <strong>Ajustes → Biblioteca compartida</strong>. Libera espacio aquí y no cambia nada en la nube.',
  'storage.theLimits': 'Los límites',
  'storage.limitsNote':
    'El plan gratuito da {quota} de almacenamiento y {egress} de transferencia al mes. El almacenamiento es el número de arriba. <strong>La transferencia no se puede medir desde aquí</strong> — solo la cuenta Supabase — así que si la reproducción empieza a fallar a final de mes, mira la página de uso del proyecto antes de buscar un fallo.',
  'storage.outgrowingNote':
    'Quedarse sin almacenamiento del todo no es el final: la sección <em>Outgrowing 1 GB</em> del README tiene el camino para migrar a Cloudflare R2, que es la misma app con otro bucket.',

  // --- admin panel --------------------------------------------------------
  'admin.title': 'Administración',
  'admin.ofQuotaUsed': 'de {quota} usados',
  'admin.activeAccount': 'cuenta activa',
  'admin.activeAccounts': 'cuentas activas',
  'admin.disabledCount': '{count} desactivadas',
  'admin.songsInLibrary': 'canciones en la biblioteca',
  'admin.tab.users': 'Usuarios',
  'admin.tab.invites': 'Invitaciones',
  'admin.tab.settings': 'Ajustes',
  'admin.loadingAccounts': 'Cargando cuentas…',
  'admin.noNameYet': 'Todavía sin nombre',
  'admin.you': 'tú',
  'admin.disabledTag': 'desactivada',
  'admin.noEmail': 'sin correo',
  'admin.joinedSeen': 'Se unió el {joined} · visto por última vez {seen}',
  'admin.role': 'Rol',
  'admin.role.admin': 'administrador',
  'admin.role.member': 'miembro',
  'admin.role.listener': 'oyente',
  'admin.enable': 'Activar',
  'admin.disable': 'Desactivar',
  'admin.sendReset': 'Enviar enlace',
  'admin.roleNote.admin': 'Lleva la biblioteca — sube, edita, elimina, y este panel.',
  'admin.roleNote.member': 'Escucha todo, tiene sus playlists, puede pedir canciones.',
  'admin.roleNote.listener':
    'Escucha y descarga. No puede añadir ni quitar nada de la biblioteca.',
  'admin.invitesNote':
    'Las cuentas son solo por invitación: un correo tiene que estar en esta lista antes de poder crear una cuenta con él. Retirar una invitación cierra la puerta a una cuenta nueva — no elimina a quien ya entró.',
  'admin.whoTheyAre': 'quién es (opcional)',
  'admin.invite': 'Invitar',
  'admin.joined': 'dentro',
  'admin.waiting': 'pendiente',
  'admin.withdraw': 'Retirar',
  'admin.nobodyInvited': 'Todavía no hay nadie invitado.',
  'admin.maxUpload': 'Canción más grande que se puede subir',
  'admin.maxUploadHint':
    'Se aplica a todos los que pueden subir. El techo de la biblioteca compartida es {quota} diga lo que diga esto.',
  'admin.defaultLanguage': 'Idioma con el que empiezan las cuentas nuevas',
  'admin.defaultLanguageHint': 'Después cada quien puede cambiar el suyo.',
  'admin.deleteHeading': '¿Eliminar a {name}?',
  'admin.deleteBody':
    'Su cuenta, sus playlists y las {count} que subió ({size}) se van con ella. Esto no se puede deshacer.',
  'admin.deleteAsk': 'Escribe <strong>{name}</strong> para confirmar.',
  'admin.keepIt': 'Mejor no',
  'admin.deleteForGood': 'Eliminar para siempre',
  'admin.actionFailed': 'Eso no salió adelante.',
  'admin.sendFailed': 'No se pudo enviar.',
  'admin.badMegabytes': 'Tiene que ser un número de megabytes mayor que cero.',
  'admin.languageSaved': 'Guardado — las cuentas nuevas empiezan en ese idioma.',
  'admin.uploadLimitSaved': 'Las subidas quedan limitadas a {mb} MB por canción.',

  'admin.thatAccount': 'Esa cuenta',

  // --- invites panel ------------------------------------------------------
  'invites.note':
    'En la app se puede crear cuenta, pero la base de datos rechaza a cualquiera que no esté en esta lista. Añadir un correo permite a esa persona crear la suya.',
  'invites.whoIsIt': '¿Quién es? (opcional)',
  'invites.loading': 'Cargando la lista…',
  'invites.joined': 'Dentro',
  'invites.notYet': 'Todavía no',
  'invites.withdrawJoined': 'Retira la invitación. Su cuenta se queda.',
  'invites.withdrawWaiting': 'Retira la invitación antes de que cree la cuenta.',
  'invites.emptyWarning':
    'Todavía no hay nadie invitado — ni siquiera tú, lo que significa que esta lista no se pudo leer. Revisa la conexión y vuelve a abrir los ajustes.',
  'invites.footnote':
    'Retirar una invitación solo cierra la puerta a una cuenta nueva. Quien ya tiene cuenta la conserva, con todo lo que haya descargado.',

  // --- companion panel ----------------------------------------------------
  'companion.intro':
    'YouTube ya no entrega audio reproducible a nada que sea un navegador o un WebView, así que las descargas pasan por un pequeño servicio que tú ejecutas. Mira <code>companion/README.md</code> para desplegarlo — es un Dockerfile y dos variables de entorno.',
  'companion.useThisPhone': 'Usar el companion que corre en este teléfono',
  'companion.address': 'Dirección',
  'companion.token': 'Token',
  'companion.tokenPlaceholder': 'MUSIC_HUB_TOKEN del servidor',
  'companion.checking': 'Comprobando…',
  'companion.saveAndTest': 'Guardar y probar',
  'companion.hideToken': 'Ocultar token',
  'companion.showToken': 'Ver token',
  'companion.forget': 'Olvidar',
  'companion.reachable': 'Responde — yt-dlp {version}{cookies}.',
  'companion.withCookies': ', con cookies',
  'companion.noCookies':
    '⚠ No hay cookies cargadas. Un companion en un proveedor de hosting será rechazado por YouTube ("confirma que no eres un bot") — añade un <code>cookies.txt</code> como archivo secreto y define <code>YTDLP_COOKIES_FILE</code>. Uno que corra en tu propia conexión no las necesita.',
  'companion.workerHeading': 'Descargar canciones con la app cerrada',
  'companion.workerNote':
    'Lo que pide la familia se descarga normalmente mientras Music Hub está abierto en este teléfono. Enlazado, el companion lo hace solo — con su propia cuenta, así que una canción pedida a medianoche está en la biblioteca por la mañana.',
  'companion.linking': 'Enlazando…',
  'companion.link': 'Enlazar este companion',
  'companion.relink': 'Volver a enlazar',
  'companion.tapAgainToStop': 'Toca otra vez para parar',
  'companion.stop': 'Parar',
  'companion.workerFootnote':
    'Al enlazarlo se crea una contraseña que nadie tiene que recordar, y la única copia se queda en este teléfono — así que si se pierde, vuelve a enlazar desde aquí en vez de buscarla. Esa cuenta puede añadir a la biblioteca compartida, que es justo lo que hace al descargar una canción.',
  'companion.footnote':
    'La dirección y el token se guardan solo en este dispositivo — el token no se sincroniza con los demás y nunca se acerca a la biblioteca compartida.',
  'companion.noAnswer': 'El companion no respondió.',
  'companion.workerLinked': 'El companion ya descargará por su cuenta las canciones pedidas.',
  'companion.linkFailed': 'No se pudo enlazar el companion.',
  'companion.workerStopped': 'Parado. Las peticiones solo se atienden con la app abierta.',
  'companion.stopFailed': 'No se pudo parar el companion.',

  // --- updates ------------------------------------------------------------
  'update.checkForUpdates': 'Buscar actualizaciones',
  'update.checking': 'Buscando…',
  'update.versionAvailable': 'La versión {version} está disponible',
  'update.newerBuild': 'Hay una versión más nueva lista para cargar.',
  'update.readyToInstall': 'La actualización está lista para instalar.',
  'update.allowInstalls': 'Permite que Music Hub instale apps y vuelve a pulsar Actualizar.',
  'update.notNow': 'Ahora no',
  'update.update': 'Actualizar',
  'update.installing': 'Instalando…',
  'update.downloading': 'Descargando…',
  'update.reload': 'Recargar',
  'update.banner': 'Hay una versión nueva de Music Hub lista.',

  'update.installFailed': 'No se pudo instalar la actualización.',
  'companion.badToken': 'El companion rechazó el token.',
  'companion.unreachable': 'No se pudo conectar con el companion — puede estar dormido, la dirección puede estar mal, o la CSP del sitio lo está bloqueando.',

  // --- artwork ------------------------------------------------------------
  'artwork.missing': '{count} canción(es) no tienen portada.',
  'artwork.searching': 'Buscando…',
  'artwork.find': 'Buscar portadas',

  'artwork.lookingUp': 'Buscando portadas — {done} de {total}',
  'artwork.withoutArtwork': '{count} canción(es) sin portada',
  'artwork.noneFound': 'No se encontró portada para esa canción.',
  'artwork.noneFoundMany': 'No se encontraron portadas para esas canciones.',
  'artwork.foundFor': 'Se encontró portada para {found} de {total} canción(es).',
  'update.downloadingBanner': 'Descargando la actualización…',
  'update.versionBanner': 'Music Hub {version} ya está disponible.',
  'update.install': 'Instalar',

  // --- install hint -------------------------------------------------------
  'install.title': 'Instalar Music Hub',
  'install.iosSteps':
    'Toca <strong>Compartir</strong> en Safari y después <strong>Añadir a pantalla de inicio</strong>. Se abre a pantalla completa y tus canciones descargadas siguen disponibles sin conexión.',
  'install.install': 'Instalar',

  // --- sync / library toasts ---------------------------------------------
  'sync.offlineLibrary': 'Estás sin conexión — mostrando la biblioteca guardada en este dispositivo.',
  'sync.offlineUploads': 'Estás sin conexión — para subir hace falta internet.',
  'sync.offlineDownloads': 'Estás sin conexión — para descargar hace falta internet.',
  'sync.uploaded': 'Se subieron {count} canción(es) a la nube.',
  'sync.uploadsFailed': 'Fallaron {count} subida(s).',
  'sync.availableOffline': '{count} canción(es) disponibles sin conexión.',
  'library.wouldDeleteForGood':
    'Esta canción está solo en este dispositivo — subirla primero la eliminaría para siempre.',
  'library.offlineDelete':
    'Estás sin conexión — vuelve a eliminar esta canción cuando tengas internet.',
  'library.sharedNotYours': 'Esta canción es de la biblioteca compartida — solo Xaviel puede quitarla. Toca ● para liberar espacio en este dispositivo.',
  'library.playlistLocalOnly': 'La playlist se quitó aquí pero no en la nube.',
  'library.tooBig':
    '"{title}" ocupa {size} MB — más que el límite de {limit} MB por canción, así que se queda en este dispositivo.',

  // --- service messages ---------------------------------------------------
  'err.noConnectionMoment': 'Sin conexión — inténtalo de nuevo en un momento.',
  'err.noConnectionServer': 'No se pudo conectar con el servidor — inténtalo cuando tengas conexión.',
  'update.onLatest': 'Ya tienes la última versión ({version}).',
  'update.checkFailed': 'No se pudieron buscar actualizaciones.',
  'update.rateLimited': 'GitHub está limitando las comprobaciones de actualización. Prueba dentro de unos minutos.',
  'update.githubUnreachable': 'No se pudo conectar con GitHub para buscar actualizaciones.',
  'sync.showingLocal': 'Sin conexión — mostrando la biblioteca guardada en este dispositivo.',
  'sync.failed': 'Falló la sincronización: {message}',
  'library.uploadFailed': 'No se pudo guardar "{title}" en la nube. Se queda en este dispositivo.',
  'library.cloudFull': 'La nube está llena — se alcanzó el límite de 1 GB, así que "{title}" se queda en este dispositivo. Elimina alguna canción de la nube para hacer sitio.',
  'library.uploadOffline': 'Sin conexión — "{title}" se queda en este dispositivo. Toca ↑ para reintentarlo luego.',
  'library.uploadError': 'Falló la subida de "{title}": {message}',
  'player.nothingOffline': 'No queda nada en la cola que pueda sonar sin conexión — descarga canciones con ⬇ para escucharlas sin internet.',
  'add.needsAndroidApp': 'Para añadir desde YouTube hace falta la app de Android.',
  'add.fetchedForLibrary': 'Se descargó "{title}" para la biblioteca ✔',
  'add.downloadedNotUploaded': 'Se descargó, pero no se pudo subir a la biblioteca compartida.',
  'add.tooManyWaiting': 'Ya tienes {max} canciones esperando — deja que esas terminen primero.',
  'companion.noToken': 'El servidor está en pie pero no tiene MUSIC_HUB_TOKEN, así que rechazará todas las peticiones.',
  'companion.emptyFile': 'El companion devolvió un archivo vacío.',
  'companion.notSetUp': 'El companion no está configurado.',
  'companion.workerSignedInFailed': 'Con sesión iniciada, pero el último intento falló: {error}',
  'companion.workerNotSignedIn': 'Enlazado como {account}, todavía sin iniciar sesión — {done}.',
  'companion.workerWorking': 'Funcionando como {account} — {done}.',

  // --- fill from a link / wanted list -------------------------------------
  'link.fillFromLink': 'Rellenar desde un enlace',
  'link.placeholder': 'Pega un enlace de Spotify o YouTube',
  'link.fetch': 'Buscar',
  'link.looking': 'Buscando…',
  'link.apply': 'Usar esto',
  'link.failed': 'No se pudo leer ese enlace.',
  'link.nothingFound': 'Ese enlace no devolvió nada.',
  'link.metadataOnly':
    'Solo títulos y portadas — Music Hub nunca descarga audio de estos sitios.',
  'link.trackCount': '{count} canciones en ese enlace',
  'link.addAllToWanted': 'Añadir las {count} a la lista de deseos',

  'wanted.title': 'Lista de deseos',
  'wanted.tab': 'deseos',
  'wanted.add': 'Añadir a la lista',
  'wanted.added': 'Se añadieron {count} a tu lista de deseos.',
  'wanted.empty': 'Todavía no hay nada en la lista.',
  'wanted.emptyBody':
    'Una lista de deseos, no una cola de descargas. Pega un enlace de Spotify o YouTube y se rellenan el título, el artista y la portada — después añade el audio desde tus propios archivos. Music Hub no descarga de Spotify ni de YouTube.',
  'wanted.markAcquired': 'Marcar como conseguida',
  'wanted.markPending': 'Todavía la quiero',
  'wanted.acquiredHeading': 'Ya conseguidas',
  'wanted.remove': 'Quitar de la lista',
  'wanted.foundOne': '"{title}" está en tu lista de deseos — ¿la marco como conseguida?',
  'wanted.markIt': 'Márcala',
  'wanted.notNow': 'Ahora no',

  // --- contributing to the shared library ---------------------------------
  'share.yourShare': 'Tu parte',
  'share.usedOf': '{used} de {quota} usados',
  'share.unlimited': 'Sin límite — la biblioteca es tuya.',
  'share.nearlyFull': 'Casi has gastado toda tu parte. Pídele más sitio a Xaviel, o quita algo que hayas subido.',
  'share.uploadToShared': 'Añadir a la biblioteca compartida',
  'share.waitsForApproval':
    'Las canciones que añadas esperan a que Xaviel las deje entrar. En cuanto lo haga, las ve todo el mundo.',
  'share.pending': 'Esperando aprobación',
  'share.pendingBadge': 'pendiente',
  'share.pendingNote': 'Hasta que se apruebe, solo la ves tú.',
  'share.withdraw': 'Retirar',
  'share.overQuota': 'Eso es más de lo que cabe en tu parte.',

  'admin.tab.pending': 'Pendientes',
  'admin.pendingHeading': 'Esperando entrar en la biblioteca',
  'admin.pendingNote':
    'Canciones que han subido los miembros. Nadie más que quien la subió puede verla hasta que la apruebes; rechazarla elimina la canción y su audio.',
  'admin.pendingEmpty': 'No hay nada esperando.',
  'admin.approve': 'Aprobar',
  'admin.reject': 'Rechazar',
  'admin.approved': 'Aprobada — ya la ve todo el mundo.',
  'admin.rejected': 'Rechazada y eliminada.',
  'admin.uploadedBy': 'la añadió {name}',
  'admin.memberQuota': 'Cuánto puede añadir cada miembro',
  'admin.memberQuotaHint':
    'Se aplica a quien no tenga una cifra propia. Los administradores no tienen límite. Lo que tengan pendiente también cuenta.',
  'admin.quotaFor': 'Parte de {name}',
  'admin.quotaDefault': 'lo que diga la biblioteca',
  'admin.quotaSaved': 'Guardado — esa es su nueva parte.',

  // --- welcome box --------------------------------------------------------
  'welcome.languageTitle': 'Elige tu idioma',
  'welcome.languageBody': 'Puedes cambiarlo después en Ajustes.',
  'welcome.nameTitle': '¿Cómo te llamamos?',
  'welcome.nameBody': 'Este es el nombre que el resto de la casa ve en tus playlists.',
  'welcome.namePlaceholder': 'Tu nombre',
  'welcome.tourAddTitle': 'Añade tu música',
  'welcome.tourAddBody':
    'La pestaña ＋ coge archivos de audio directamente de este dispositivo — o un enlace, si alguien puede descargarlo por ti.',
  'welcome.tourOfflineTitle': 'Escucha sin cobertura',
  'welcome.tourOfflineBody':
    'Descarga una canción con el botón ⬇ y suena en modo avión, en el metro, donde sea.',
  'welcome.tourInstallTitle': 'Tenla en tu pantalla de inicio',
  'welcome.tourInstallBody':
    'En iPhone: Compartir y después Añadir a pantalla de inicio. En un ordenador: el botón de instalar en la barra de direcciones.',
  'welcome.next': 'Siguiente',
  'welcome.back': 'Atrás',
  'welcome.finish': 'Empezar a escuchar',
  'welcome.skip': 'Saltar',
};
