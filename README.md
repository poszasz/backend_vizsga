# Car Cards
## A projektről

>Car Cards egy autós kártyagyűjtő webalkalmazás. A játékosok packokat nyithatnak, autókat gyűjthetnek, és cserélhetnek egymással a beépített piactéren. A felhasználók ajánlatokat küldhetnek, amelyeket elfogadhatnak vagy elutasíthatnak. Az értesítések segítenek nyomon követni a tranzakciókat. A cél a legnagyobb és legértékesebb gyűjtemény összeállítása.

---

## Készítette
- Tóth Ádám Kornél és Várhidi Olivér György (Backend, SQL adatbázis)
- [GitHub repo](https://github.com/poszasz/backend_vizsga)

---

### Fejlesztési környezet
- **Node.js**
- **MySQL**
---

## Adatbázis

- cards
    - id
	- name
	- manufacturer
	- image_url
	- fuel
    - gearbox
    - engine
    - horsepower
    - torque
    - weight
    - length
    - top_speed
    - acceleration
- notifications
	- id
	- user_id
	- type
    - title
    - messages
    - related_id
    - is_read
    - created_at
- market_offers
	- id
	- listing_id
	- offer_user_card_id
    - created_at
    - status
- users
	- id
	- email
	- password
	- username
- user_packs
	- id
	- user_id
	- acquired_at
- market_listings
	- id
	- user_card_id
    - status
- user_cards
	- id
	- user_id
	- card_id
    - acquired_at

![kép az adatbáziskapcsolatokról](https://snipboard.io/kBlVRE.jpg)
>[adatbázis diagram](https://drawsql.app/teams/asd-660/diagrams/car-cards-2)

---
## Backend

A Car Cards backendje Node.js és Express segítségével működik, amely kommunikációs hidat biztosít a React frontend és a MySQL adatbázis között. A felhasználók packokat nyithatnak, autókat gyűjthetnek, és egymással kereskedhetnek a beépített piactéren.


### Telepítés és futtatás
```bash
git clone https://github.com/poszasz/backend_vizsga.git
cd backend_vizsga
npm i
npm run dev
```





### Használt package-ek
- [bcryptjs](https://www.npmjs.com/package/bcryptjs)
- [cookie-parser](https://www.npmjs.com/package/cookie-parser)
- [cors](https://www.npmjs.com/package/cors)
- [dotenv](https://www.npmjs.com/package/dotenv)
- [express](https://www.npmjs.com/package/express)
- [jsonwebtoken](https://www.npmjs.com/package/jsonwebtoken)
- [mysql2](https://www.npmjs.com/package/mysql2)
- [emailvalidator ](https://www.npmjs.com/package/emailvalidator)
- [nodemon](https://www.npmjs.com/package/nodemon)

````javascript
"dependencies": {
    "bcryptjs": "^3.0.3",
    "cookie-parser": "^1.4.7",
    "cors": "^2.8.6",
    "dotenv": "^17.4.2",
    "express": "^5.2.1",
    "jsonwebtoken": "^9.0.3",
    "mysql2": "^3.17.2",
    "node-email-verifier": "^4.0.0",
    "nodemon": "^3.1.14"
  },
  "devDependencies": {
    "nodemon": "^3.1.7"
  }
````
>package.json
---  

### Biztonság
- A jelszavak **bcryptjs** segítségével vannak hashelve – A jelszavakat egyirányú hash függvény és véletlenszerű só biztonságosan tárolja az adatbázisban.
- **Middleware** - A védett végpontok elérése előtt egy központi middleware ellenőrzi a JWT token érvényességét.
- **.env** - A környezeti változókban tárolt adatbázis és JWT beállítások nem kerülhetnek verziókövetés alá.
- **JWT** - A felhasználó bejelentkezés után egy aláírt tokent kap, amelyet a kliens a további kérésekhez csatol.
---

### Végpontok
Az app.js -be meghívtuk az összes routes fájlt és mint egy közlekedési csomópont igazgatja a végpontokat.
````javascript
app.use('/game', express.static(path.join(__dirname, 'thegame')));

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/achievements', achievementRoutes);
app.use('/api/forum', forumRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/game', gameRoutes);
````
>app.js
---
1. Auth végpontok

    | Művelet        | HTTP                                               | Végpont         | Leírás                                                                 |
    |----------------|----------------------------------------------------|-----------------|------------------------------------------------------------------------|
    | Regisztráció   | ![POST](https://img.shields.io/badge/-POST-yellow) | `/registration` | Új felhasználó regisztrálása                                          |
    | Bejelentkezés  | ![POST](https://img.shields.io/badge/-POST-yellow) | `/login`        | Felhasználó bejelentkezése                                            |
    | Kijelentkezés  | ![POST](https://img.shields.io/badge/-POST-yellow) | `/logout`       | Felhasználó kijelentkezése                  |

    ```javascript
    app.post('/registration', async (req, res))
    app.post('/login', async (req, res))
    app.post('/logout', async (req, res))
    ```
2. User végpontok
    | Művelet                    | HTTP                                               | Végpont              | Leírás                                                                 |
    |----------------------------|----------------------------------------------------|----------------------|------------------------------------------------------------------------|
    | saját profil lekérése      | ![GET](https://img.shields.io/badge/-GET-green)     | `/adataim`       | A bejelentkezett felhasználó saját adatainak lekérése    |
    | email szerkesztése        | ![PUT](https://img.shields.io/badge/-PUT-blue)   | `/email`       | A felhasználó emailjének módosítása      |
    | email szerkesztése        | ![PUT](https://img.shields.io/badge/-PUT-blue)   | `/username`       | A felhasználó felhasználónevének módosítása      |
    | email szerkesztése        | ![PUT](https://img.shields.io/badge/-PUT-blue)   | `/password`       | A felhasználó jelszavának módosítása      |
    | fiók törlése        | ![DELETE](https://img.shields.io/badge/-DELETE-red)   | `/account`       | A felhasználó fiókjának törlése     |

    ```javascript
    app.get('/adataim', auth, async (req, res))
    app.put('/email', auth, async (req, res))
    app.put('/username', auth, async (req, res))
    app.put('/password', auth, async (req, res))
    app.delete('/account', auth, async (req, res))
    ```
    
3. Market végpontok
    | Művelet                           | HTTP                                               | Végpont                  | Leírás                                                                   |
    |----------------------------------|----------------------------------------------------|--------------------------|--------------------------------------------------------------------------|
    | market összes lekérdezése     | ![GET](https://img.shields.io/badge/-GET-green)     | `/market-listings`      | A marketen lévő összes ajánlat lekérdezése               |
    | új listing létrehozása   | ![GET](https://img.shields.io/badge/-POST-yellow)     | `/create-listing` | A felhasználó új listinget tud létrehozni              |
    | ajánlat tétele      | ![POST](https://img.shields.io/badge/-POST-yellow)     | `/make-offer`                   | A felhasználó egy offerre ajánlatot tud tenni más felhasználóknak                               |
    | saját offerek lekérése        | ![GET](https://img.shields.io/badge/-GET-green)     | `/my-pending-offers`      | A felhasználó saját függőben lévő offerjeinek lekérdezése             |
    | ajánlat elfogadása         | ![POST](https://img.shields.io/badge/-POST-yellow) | `/accept-offer/:offerId`        | Más játékostól érkezett ajánlat elfogadása             |
    | ajánlat elutasitasa         | ![POST](https://img.shields.io/badge/-POST-yellow) | `/reject-offer/:offerId`        | Más játékostól érkezett ajánlat elutasitasa             |
    | saját listing törlése        | ![DELETE](https://img.shields.io/badge/-DELETE-red) | `/listing/:listingId`        | A felhasználó saját listingjeinek törlése         |
    | offer törlése        | ![DELETE](https://img.shields.io/badge/-DELETE-red) | `/offer/:offerId`        | A felhasználó offerjének törlése       |
    | beérkező ajánlatok lekérése      | ![GET](https://img.shields.io/badge/-GET-green)     | `/incoming-offers`      | A felhasználónak tett ajánlatok lekérése           |

    ```javascript
    app.get('/market-listings', auth, async (req, res))
    app.post('/create-listing', auth, async (req, res))
    app.post('/make-offer', auth, async (req, res))
    app.get('/my-pending-offers', auth, async (req, res))
    app.post('/accept-offer/:offerId', auth, async (req, res))
    app.post('/reject-offer/:offerId', auth, async (req, res))
    app.get('/my-listings', auth, async (req, res))
    app.delete('/listing/:listingId', auth, async (req, res)
    app.delete('/offer/:offerId', auth, async (req, res))
    app.get('/incoming-offers', auth, async (req, res))
    ```
4. Packok végpontok
    | Művelet                      | HTTP                                               | Végpont                     | Leírás                                                                 |
    |-----------------------------|----------------------------------------------------|-----------------------------|------------------------------------------------------------------------|
    | packok lekérdezése        | ![GET](https://img.shields.io/badge/-GET-green) | `/my-packs`                  | A felhasználó packjainak lekérése                                            |
    | packok nyitása        | ![GET](https://img.shields.io/badge/-GET-green) | `/open-pack`                  | A felhasználó új kártyákat nyithat                                         |
   

    ```javascript
    app.get('/my-packs', auth, async (req, res))
    app.post('/open-pack', auth, async (req, res))
    ```
5. Értesítések végpontok
    | Művelet                          | HTTP                                               | Végpont               | Leírás                                                                 |
    |----------------------------------|----------------------------------------------------|------------------------|------------------------------------------------------------------------|
    | értesítések lekérdezése       | ![GET](https://img.shields.io/badge/-GET-green)     | `/notifications`             | A felhasználónak jott összes értesítés lekérése    |
    | értesítések olvasása       | ![PUT](https://img.shields.io/badge/-PUT-blue)     | `/notifications/:id/read`             | A felhasználónak az értesítésre kattintva elolvashatja az ertesitest egyenként    |
    | összes értesítések olvasása       | ![PUT](https://img.shields.io/badge/-PUT-blue)     | `/notifications/read-all`             | A felhasználónak az értesítésre kattintva elolvashatja az összes ertesitest egyenként    |
 


    ```javascript
    app.get('/notifications', auth, async (req, res))
    app.put('/notifications/:id/read', auth, async (req, res)
    app.put('/notifications/read-all', auth, async (req, res))

    ```

---



## Frontend

- [Github repo](https://github.com/poszasz/frontend_vizsga)
- [Frontend](https://mycarcards.netlify.app/)

## Használt eszközök
- [VS code](https://code.visualstudio.com)
- [NPM](https://www.npmjs.com)
- [Postman](https://www.postman.com)
- [DrawSQL](https://drawsql.app)
- [W3Schools](https://www.w3schools.com)
- [StackOverflow](https://stackoverflow.com/questions)
- [ChatGPT](https://chatgpt.com)
- [Tabnine](https://www.tabnine.com)
- [GitHub](https://github.com/)
- [Google Drive](https://workspace.google.com/products/drive/)
- [PhpMyAdmin](https://www.phpmyadmin.net)
