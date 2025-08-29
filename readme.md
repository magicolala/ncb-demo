# NeoChessBoard.js

Un composant d'échiquier JavaScript léger, moderne et sans dépendances, conçu pour être simple et performant. Il peut être enrichi avec `chess.js` pour une validation complète des règles.

## Fonctionnalités

* **Zéro Dépendance :** Fonctionne de manière autonome.
* **Intégration avec `chess.js` :** Utilise `chess.js` s'il est présent pour une validation complète des règles (échec, mat, etc.).
* **Moderne :** Écrit en tant que module ES6.
* **Interactif :** Supporte le glisser-déposer (drag-and-drop) et les clics pour déplacer les pièces.
* **Personnalisable :** Thèmes et options de configuration.
* **API Programmatique :** Contrôlez l'échiquier via une API simple.
* **Système d'Événements :** Réagissez aux actions des utilisateurs.
* **Dessins :** Ajoutez des flèches et surlignez des cases.

## Installation et Utilisation

1. **Créez un conteneur** dans votre fichier HTML.

    ```html
    <div id="board"></div>
    ```

2. **(Optionnel mais recommandé)** Incluez `chess.js` pour une gestion complète des règles. Placez cette balise avant votre script principal.

    ```html
    <script src="https://cdnjs.cloudflare.com/ajax/libs/chess.js/1.0.0-beta.8/chess.min.js"></script>
    ```

3. **Importez et montez l'échiquier** dans votre script JavaScript. Assurez-vous que votre balise `<script>` a l'attribut `type="module"`.

    ```html
    <script type="module">
      import { mountChessboard } from './NeoChessBoard.js';

      const board = mountChessboard('#board', {
        theme: 'midnight',
        interactive: true,
      });

      // Vous pouvez maintenant interagir avec l'échiquier
      window.board = board; // Pour un accès facile depuis la console
    </script>
    ```

## Configuration

Passez un objet d'options comme second argument à `mountChessboard(selector, options)` :

* `theme` (string): Le thème visuel à utiliser. Thèmes intégrés : `'classic'`, `'midnight'`. Défaut : `'classic'`.
* `interactive` (boolean): Si les joueurs peuvent déplacer les pièces. Défaut : `true`.
* `fen` (string): La position de départ au format FEN. Défaut : position de départ standard.
* `orientation` (string): La couleur en bas de l'échiquier. `'white'` ou `'black'`. Défaut : `'white'`.

## API

L'objet retourné par `mountChessboard` expose plusieurs méthodes :

* `board.move(from, to)`: Déplace une pièce de `from` à `to` (ex: `'e2'`, `'e4'`). Retourne `true` si le coup est valide.
* `board.setPosition(fen, { immediate: boolean })`: Met à jour l'échiquier avec une nouvelle position FEN. L'animation est activée par défaut. Passez `{ immediate: true }` pour une mise à jour instantanée.
* `board.flip()`: Inverse l'orientation de l'échiquier.
* `board.getPosition()`: Retourne la position actuelle au format FEN.
* `board.addArrow(from, to)`: Dessine une flèche sur l'échiquier.
* `board.clearArrows()`: Efface toutes les flèches.
* `board.highlight(square)`: Surligne une case.
* `board.clearHighlights()`: Efface tous les surlignages.
* `board.on(eventName, callback)`: Écoute un événement.

## Événements

Écoutez les événements avec la méthode `.on()` :

* `move`: Déclenché après un coup valide.

    ```javascript
    board.on('move', ({ from, to, fen }) => {
      console.log(`Pièce déplacée de ${from} à ${to}. Nouvelle FEN : ${fen}`);
    });
    ```

* `illegal`: Déclenché lors d'une tentative de coup illégal.

    ```javascript
    board.on('illegal', ({ from, to, reason }) => {
      console.warn(`Coup illégal de ${from} à ${to}. Raison : ${reason}`);
    });
    ```

* `update`: Déclenché après une mise à jour de la position (ex: `setPosition`).

    ```javascript
    board.on('update', ({ fen }) => {
      console.log(`L'échiquier a été mis à jour. FEN : ${fen}`);
    });
    ```

## Licence

MIT
