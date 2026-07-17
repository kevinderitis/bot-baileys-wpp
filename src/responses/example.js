const responses = {
  saludos: [
    '¡Hola! ¿Cómo estás? 😊',
    '¡Buenas! ¿En qué puedo ayudarte hoy?',
    'Hola, un gusto saludarte!',
    '¡Hey! Qué bueno saber de ti.',
    'Holaaaa, ¿cómo va todo?',
  ],

  bienvenida: [
    '¡Bienvenido! Gracias por contactarnos.',
    'Qué alegría tenerte por aquí. Bienvenido!',
    'Bienvenido a nuestro servicio. Estamos para ayudarte.',
    'Gracias por escribirnos. Bienvenido, cuéntanos cómo podemos ayudarte.',
    'Hola y bienvenido! Estaremos encantados de atenderte.',
  ],

  como_estas: [
    '¡Muy bien! Gracias por preguntar. ¿Y tú?',
    'Todo bien por aquí, ocupado pero contento. ¿Tú cómo estás?',
    'Bien, bien, trabajando como siempre. ¿Qué tal tú?',
    'Excelente, con mucha energía hoy. ¿En qué puedo ayudarte?',
    'De maravilla! Gracias por preguntar.',
  ],

  agradecimiento: [
    '¡De nada! Para eso estamos.',
    'No hay de qué, un placer ayudarte.',
    'A ti por contactarnos, cuando necesites algo aquí estamos.',
    'Con gusto, cuando quieras.',
    '¡Un placer! Cualquier cosa, aquí andamos.',
  ],

  despedida: [
    '¡Hasta luego! Que tengas un excelente día.',
    'Cuidate mucho, nos vemos pronto.',
    'Un abrazo, que estés muy bien.',
    'Hasta pronto, fue un gusto hablar contigo.',
    'Nos vemos luego, cualquier cosa nos dices.',
  ],

  no_entiendo: [
    'Disculpa, no estoy seguro de entenderte bien. ¿Podrías repetirlo de otra forma?',
    'Perdona, no logro captar exactamente lo que necesitas. ¿Me ayudas con más contexto?',
    'Hmm, no entendí muy bien. ¿Podrías explicarme de nuevo?',
    'No estoy seguro de haber entendido. ¿Me lo explicas un poco más?',
  ],

  random: [
    'Qué interesante lo que me cuentas! Cuéntame más.',
    'Vaya, no sabía eso. Qué curioso.',
    'Claro, claro, te entiendo perfectamente.',
    'Déjame pensar... sí, tiene sentido.',
    'Ah, ya veo. Qué bien que me lo hayas comentado.',
    'Tiene toda la razón del mundo.',
    'Qué bien suena eso, la verdad.',
    'Genial, me alegra mucho escuchar eso.',
    'A veces la vida da sorpresas, ¿no crees?',
    'Es una buena perspectiva, sin duda.',
  ],
};

function getRandomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickResponse(type) {
  if (responses[type]) {
    return getRandomFrom(responses[type]);
  }
  return getRandomFrom(responses.random);
}

export { responses, getRandomFrom, pickResponse };
